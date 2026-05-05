package controllers

import (
	"context"
	"fmt"
	"time"

	cmapi "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmutil "github.com/cert-manager/cert-manager/pkg/api/util"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/tools/record"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	pkiv1 "github.com/oriolrius/pki-manager-issuer/api/v1alpha1"
	"github.com/oriolrius/pki-manager-issuer/internal/issuer/signer"
)

// CertificateRequestReconciler reconciles cert-manager CertificateRequest objects
// whose issuerRef matches our group.
type CertificateRequestReconciler struct {
	client.Client
	Scheme                   *runtime.Scheme
	Recorder                 record.EventRecorder
	ClusterResourceNamespace string
}

// +kubebuilder:rbac:groups=cert-manager.io,resources=certificaterequests,verbs=get;list;watch;update
// +kubebuilder:rbac:groups=cert-manager.io,resources=certificaterequests/status,verbs=get;update;patch

const ourGroup = "pki-manager.issuer.io"

func (r *CertificateRequestReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	cr := &cmapi.CertificateRequest{}
	if err := r.Get(ctx, req.NamespacedName, cr); err != nil {
		if apierrors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	// Ignore CRs not targeting our issuer group
	if cr.Spec.IssuerRef.Group != ourGroup {
		return ctrl.Result{}, nil
	}

	// Skip already-finished CRs
	if cmutil.CertificateRequestHasCondition(cr, cmapi.CertificateRequestCondition{
		Type:   cmapi.CertificateRequestConditionReady,
		Status: cmmeta_True(),
	}) {
		return ctrl.Result{}, nil
	}
	if cmutil.CertificateRequestHasCondition(cr, cmapi.CertificateRequestCondition{
		Type:   cmapi.CertificateRequestConditionDenied,
		Status: cmmeta_True(),
	}) {
		setReady(cr, cmapi.CertificateRequestReasonDenied, "CertificateRequest was denied")
		return ctrl.Result{}, r.Status().Update(ctx, cr)
	}

	// cert-manager 1.16+: must be Approved before signing
	if !cmutil.CertificateRequestIsApproved(cr) {
		logger.Info("CertificateRequest not yet approved, requeueing")
		return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
	}

	// Resolve issuer
	spec, secretNS, errMsg := r.resolveIssuer(ctx, cr)
	if errMsg != "" {
		r.Recorder.Eventf(cr, corev1.EventTypeWarning, "IssuerError", errMsg)
		setReady(cr, cmapi.CertificateRequestReasonPending, errMsg)
		return ctrl.Result{RequeueAfter: 30 * time.Second}, r.Status().Update(ctx, cr)
	}

	// Load auth secret
	secret := &corev1.Secret{}
	if err := r.Get(ctx, types.NamespacedName{Namespace: secretNS, Name: spec.AuthSecretRef.Name}, secret); err != nil {
		setReady(cr, cmapi.CertificateRequestReasonPending, "secret not found: "+err.Error())
		return ctrl.Result{RequeueAfter: 30 * time.Second}, r.Status().Update(ctx, cr)
	}
	key := spec.AuthSecretRef.Key
	if key == "" {
		key = "token"
	}
	token, ok := secret.Data[key]
	if !ok {
		setReady(cr, cmapi.CertificateRequestReasonPending, "secret missing key "+key)
		return ctrl.Result{RequeueAfter: 30 * time.Second}, r.Status().Update(ctx, cr)
	}

	// Build signer client and sign
	c := signer.New(spec.URL, string(token), signer.WithCABundle(spec.CABundle))
	durationDays := 90
	if cr.Spec.Duration != nil {
		durationDays = int(cr.Spec.Duration.Duration.Hours() / 24)
		if durationDays < 1 {
			durationDays = 1
		}
	}
	certType := spec.CertificateType
	if certType == "" {
		certType = inferCertType(cr.Spec.Usages)
	}

	resp, err := c.Sign(ctx, &signer.SignRequest{
		CSRPem:          string(cr.Spec.Request),
		DurationDays:    durationDays,
		RequestUID:      string(cr.UID),
		CertificateType: certType,
		K8sNamespace:    cr.Namespace,
		K8sResource:     cr.Name,
	})
	if err != nil {
		r.Recorder.Eventf(cr, corev1.EventTypeWarning, "SignFailed", err.Error())
		setReady(cr, cmapi.CertificateRequestReasonFailed, err.Error())
		return ctrl.Result{}, r.Status().Update(ctx, cr)
	}

	cr.Status.Certificate = []byte(resp.CertificatePEM)
	cr.Status.CA = []byte(resp.ChainPEM)
	setReady(cr, cmapi.CertificateRequestReasonIssued, fmt.Sprintf("Issued serial %s", resp.SerialNumber))
	r.Recorder.Eventf(cr, corev1.EventTypeNormal, "Issued", "Certificate issued: %s", resp.SerialNumber)
	logger.Info("CertificateRequest signed", "serial", resp.SerialNumber, "idempotent", resp.Idempotent)
	return ctrl.Result{}, r.Status().Update(ctx, cr)
}

func (r *CertificateRequestReconciler) resolveIssuer(ctx context.Context, cr *cmapi.CertificateRequest) (*pkiv1.IssuerSpec, string, string) {
	switch cr.Spec.IssuerRef.Kind {
	case "Issuer":
		obj := &pkiv1.Issuer{}
		if err := r.Get(ctx, types.NamespacedName{Namespace: cr.Namespace, Name: cr.Spec.IssuerRef.Name}, obj); err != nil {
			return nil, "", "Issuer not found: " + err.Error()
		}
		return &obj.Spec, cr.Namespace, ""
	case "ClusterIssuer":
		obj := &pkiv1.ClusterIssuer{}
		if err := r.Get(ctx, types.NamespacedName{Name: cr.Spec.IssuerRef.Name}, obj); err != nil {
			return nil, "", "ClusterIssuer not found: " + err.Error()
		}
		return &obj.Spec, r.ClusterResourceNamespace, ""
	}
	return nil, "", "unsupported issuerRef.Kind: " + cr.Spec.IssuerRef.Kind
}

func (r *CertificateRequestReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&cmapi.CertificateRequest{}).
		Complete(r)
}

func inferCertType(usages []cmapi.KeyUsage) string {
	hasServer, hasClient := false, false
	for _, u := range usages {
		switch u {
		case cmapi.UsageServerAuth:
			hasServer = true
		case cmapi.UsageClientAuth:
			hasClient = true
		}
	}
	switch {
	case hasServer && hasClient:
		return "dual"
	case hasServer:
		return "server"
	case hasClient:
		return "client"
	default:
		return "dual"
	}
}

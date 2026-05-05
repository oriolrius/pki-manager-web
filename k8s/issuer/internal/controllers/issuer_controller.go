package controllers

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	pkiv1 "github.com/oriolrius/pki-manager-issuer/api/v1alpha1"
	"github.com/oriolrius/pki-manager-issuer/internal/issuer/signer"
)

// IssuerReconciler reconciles Issuer and ClusterIssuer resources.
type IssuerReconciler struct {
	client.Client
	Scheme                  *runtime.Scheme
	ClusterResourceNamespace string // namespace for ClusterIssuer secret lookups
	Kind                    string // "Issuer" or "ClusterIssuer"
}

const issuerReconcileInterval = 5 * time.Minute

// +kubebuilder:rbac:groups=pki-manager.issuer.io,resources=issuers;clusterissuers,verbs=get;list;watch
// +kubebuilder:rbac:groups=pki-manager.issuer.io,resources=issuers/status;clusterissuers/status,verbs=get;update;patch
// +kubebuilder:rbac:groups="",resources=secrets,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=events,verbs=create;patch

func (r *IssuerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx).WithValues("kind", r.Kind)

	obj, spec, status, secretNamespace, err := r.fetch(ctx, req.NamespacedName)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	setReady := func(s metav1.ConditionStatus, reason, msg string) {
		cond := metav1.Condition{
			Type:               pkiv1.IssuerConditionReady,
			Status:             s,
			Reason:             reason,
			Message:            msg,
			LastTransitionTime: metav1.Now(),
			ObservedGeneration: obj.GetGeneration(),
		}
		// replace existing
		out := []metav1.Condition{}
		for _, c := range status.Conditions {
			if c.Type != pkiv1.IssuerConditionReady {
				out = append(out, c)
			}
		}
		status.Conditions = append(out, cond)
	}

	// Load auth secret
	secretName := types.NamespacedName{
		Namespace: secretNamespace,
		Name:      spec.AuthSecretRef.Name,
	}
	secret := &corev1.Secret{}
	if err := r.Get(ctx, secretName, secret); err != nil {
		setReady(metav1.ConditionFalse, "SecretMissing", err.Error())
		_ = r.Status().Update(ctx, obj)
		return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
	}
	key := spec.AuthSecretRef.Key
	if key == "" {
		key = "token"
	}
	tokenBytes, ok := secret.Data[key]
	if !ok || len(tokenBytes) == 0 {
		setReady(metav1.ConditionFalse, "SecretMissing", fmt.Sprintf("secret missing key %q", key))
		_ = r.Status().Update(ctx, obj)
		return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
	}

	// Probe API
	c := signer.New(spec.URL, string(tokenBytes), signer.WithCABundle(spec.CABundle))
	hctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	h, err := c.Health(hctx)
	if err != nil {
		setReady(metav1.ConditionFalse, "Unreachable", err.Error())
		_ = r.Status().Update(ctx, obj)
		return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
	}
	if h.Cluster.CAID != spec.CAID {
		setReady(metav1.ConditionFalse, "CAIDMismatch",
			fmt.Sprintf("token bound to caId=%s but spec.caId=%s", h.Cluster.CAID, spec.CAID))
		_ = r.Status().Update(ctx, obj)
		return ctrl.Result{RequeueAfter: 5 * time.Minute}, nil
	}
	setReady(metav1.ConditionTrue, "Verified", "PKI Manager reachable and CA matches")
	if err := r.Status().Update(ctx, obj); err != nil {
		return ctrl.Result{}, err
	}
	logger.Info("Issuer ready", "caId", spec.CAID, "url", spec.URL)
	return ctrl.Result{RequeueAfter: issuerReconcileInterval}, nil
}

func (r *IssuerReconciler) fetch(ctx context.Context, key types.NamespacedName) (
	client.Object, *pkiv1.IssuerSpec, *pkiv1.IssuerStatus, string, error,
) {
	if r.Kind == "ClusterIssuer" {
		obj := &pkiv1.ClusterIssuer{}
		if err := r.Get(ctx, key, obj); err != nil {
			return nil, nil, nil, "", err
		}
		return obj, &obj.Spec, &obj.Status, r.ClusterResourceNamespace, nil
	}
	obj := &pkiv1.Issuer{}
	if err := r.Get(ctx, key, obj); err != nil {
		return nil, nil, nil, "", err
	}
	return obj, &obj.Spec, &obj.Status, key.Namespace, nil
}

func (r *IssuerReconciler) SetupWithManager(mgr ctrl.Manager) error {
	if r.Kind == "ClusterIssuer" {
		return ctrl.NewControllerManagedBy(mgr).
			For(&pkiv1.ClusterIssuer{}).
			Complete(r)
	}
	return ctrl.NewControllerManagedBy(mgr).
		For(&pkiv1.Issuer{}).
		Complete(r)
}

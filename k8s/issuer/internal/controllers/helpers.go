package controllers

import (
	cmapi "github.com/cert-manager/cert-manager/pkg/apis/certmanager/v1"
	cmmeta "github.com/cert-manager/cert-manager/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func cmmeta_True() cmmeta.ConditionStatus  { return cmmeta.ConditionTrue }
func cmmeta_False() cmmeta.ConditionStatus { return cmmeta.ConditionFalse }

// setReady writes/updates the Ready condition on a CertificateRequest.
func setReady(cr *cmapi.CertificateRequest, reason, message string) {
	status := cmmeta.ConditionFalse
	if reason == cmapi.CertificateRequestReasonIssued {
		status = cmmeta.ConditionTrue
	}
	out := []cmapi.CertificateRequestCondition{}
	for _, c := range cr.Status.Conditions {
		if c.Type != cmapi.CertificateRequestConditionReady {
			out = append(out, c)
		}
	}
	cr.Status.Conditions = append(out, cmapi.CertificateRequestCondition{
		Type:               cmapi.CertificateRequestConditionReady,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: &metav1.Time{Time: metav1.Now().Time},
	})
}

// silence unused imports when build tags exclude code paths
var _ = corev1.EventTypeNormal

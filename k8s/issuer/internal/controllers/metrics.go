package controllers

import (
	"github.com/prometheus/client_golang/prometheus"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
)

var (
	signTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "pkimanager_issuer_sign_total",
		Help: "Total CertificateRequest sign attempts by result.",
	}, []string{"result"})

	signDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "pkimanager_issuer_sign_duration_seconds",
		Help:    "Duration of /external/sign calls.",
		Buckets: prometheus.ExponentialBuckets(0.05, 2, 8),
	}, []string{"result"})

	revokeTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "pkimanager_issuer_revoke_total",
		Help: "Total /external/revoke calls by result.",
	}, []string{"result"})

	issuerReady = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "pkimanager_issuer_ready",
		Help: "1 if Issuer/ClusterIssuer is Ready, 0 otherwise.",
	}, []string{"namespace", "name", "kind"})
)

func init() {
	metrics.Registry.MustRegister(signTotal, signDuration, revokeTotal, issuerReady)
}

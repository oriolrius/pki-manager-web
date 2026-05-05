module github.com/oriolrius/pki-manager-issuer

go 1.23

require (
	github.com/cert-manager/cert-manager v1.16.2
	github.com/go-logr/logr v1.4.2
	github.com/onsi/ginkgo/v2 v2.20.2
	github.com/onsi/gomega v1.34.2
	github.com/prometheus/client_golang v1.20.5
	k8s.io/api v0.32.0
	k8s.io/apimachinery v0.32.0
	k8s.io/client-go v0.32.0
	sigs.k8s.io/controller-runtime v0.20.0
)

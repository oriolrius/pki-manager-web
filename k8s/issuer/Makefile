SHELL := /bin/bash
IMG ?= ghcr.io/oriolrius/pki-manager-issuer:dev
KIND_CLUSTER ?= pki-manager-issuer-e2e
KIND_NODE_IMAGE ?= kindest/node:v1.31.2
CERT_MANAGER_VERSION ?= v1.16.2

.PHONY: help build test fmt vet tidy
help:
	@echo "Targets: build test fmt vet tidy docker-build deploy-kind e2e-local"

build:
	go build ./...

test:
	go test ./... -count=1

fmt:
	gofmt -s -w .

vet:
	go vet ./...

tidy:
	go mod tidy

docker-build:
	docker build -t $(IMG) .

# --- Local kind-based E2E (task-109.17) ---
.PHONY: kind-up kind-down install-cert-manager install-issuer e2e-local

kind-up:
	kind create cluster --name $(KIND_CLUSTER) --image $(KIND_NODE_IMAGE) || true

kind-down:
	kind delete cluster --name $(KIND_CLUSTER)

install-cert-manager:
	kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/$(CERT_MANAGER_VERSION)/cert-manager.yaml
	kubectl wait --for=condition=Available --timeout=180s -n cert-manager deployment --all

install-issuer: docker-build
	kind load docker-image $(IMG) --name $(KIND_CLUSTER)
	helm upgrade --install pki-manager-issuer deploy/helm/pki-manager-issuer \
		--namespace pki-manager-issuer --create-namespace \
		--set image.repository=$(word 1,$(subst :, ,$(IMG))) \
		--set image.tag=$(word 2,$(subst :, ,$(IMG)))

e2e-local: kind-up install-cert-manager install-issuer
	@echo "Run: kubectl apply -f test/e2e/sample-clusterissuer.yaml"
	@echo "Then: kubectl apply -f test/e2e/sample-certificate.yaml"
	@echo "Inspect: kubectl get certificate,certificaterequest,issuer.pki-manager.issuer.io,clusterissuer.pki-manager.issuer.io -A"

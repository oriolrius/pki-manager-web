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

# --- Full in-cluster E2E: deploys PKI Manager backend + Cosmian KMS + cert-manager + issuer chart ---
.PHONY: e2e-in-cluster build-backend load-images deploy-pki-manager
PKI_BACKEND_IMG ?= pki-manager-backend:e2e
PKI_BACKEND_DOCKERFILE ?= ../../docker/Dockerfile

build-backend:
	docker build -f $(PKI_BACKEND_DOCKERFILE) --target backend -t $(PKI_BACKEND_IMG) ../..

load-images: docker-build build-backend
	kind load docker-image $(IMG) $(PKI_BACKEND_IMG) --name $(KIND_CLUSTER)
	docker pull ghcr.io/cosmian/kms:latest
	kind load docker-image ghcr.io/cosmian/kms:latest --name $(KIND_CLUSTER)

deploy-pki-manager:
	kubectl apply -f test/e2e/in-cluster/00-namespace.yaml
	kubectl apply -f test/e2e/in-cluster/10-kms.yaml -f test/e2e/in-cluster/20-pki-manager.yaml
	kubectl -n pki-manager wait --for=condition=Available --timeout=180s deployment --all
	kubectl -n pki-manager exec deploy/pki-manager-backend -- node backend/dist/db/migrate.js

e2e-in-cluster: kind-up load-images deploy-pki-manager install-cert-manager
	helm upgrade --install pki-manager-issuer deploy/helm/pki-manager-issuer \
	  --namespace pki-manager-issuer --create-namespace \
	  --set image.repository=$(word 1,$(subst :, ,$(IMG))) \
	  --set image.tag=$(word 2,$(subst :, ,$(IMG))) \
	  --set image.pullPolicy=IfNotPresent
	kubectl -n pki-manager-issuer wait --for=condition=Available --timeout=120s deployment --all
	@echo
	@echo "PKI Manager backend ready at: http://pki-manager-backend.pki-manager.svc.cluster.local:3000 (in-cluster)"
	@echo "Next: bootstrap a CA + cluster token, apply ClusterIssuer + Certificate. See test/e2e/in-cluster/README.md"

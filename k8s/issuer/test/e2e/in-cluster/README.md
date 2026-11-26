# Full In-Cluster E2E

This fixture runs PKI Manager, the OpenBao fork, cert-manager and the external issuer inside a disposable kind cluster.

## Prerequisites

- `kind`, `kubectl`, `helm`, `docker`, `openssl`, `jq`
- Adequate inotify limits. Running kind (especially alongside another kind cluster) can
  exhaust the host default and crash kube-proxy/coredns with `too many open files`
  (symptom: pods stuck `Pending`, PVCs `Pending`, `dial tcp 10.96.0.1:443: i/o timeout`).
  Raise them before `kind create`:
  ```bash
  sudo sysctl -w fs.inotify.max_user_instances=1024 fs.inotify.max_user_watches=1048576
  # persist: echo -e "fs.inotify.max_user_instances=1024\nfs.inotify.max_user_watches=1048576" \
  #   | sudo tee /etc/sysctl.d/99-inotify.conf
  ```

## One-shot

```bash
make e2e-in-cluster
```

Run the target from `k8s/issuer/`. It performs these steps:

1. Create the kind cluster. The Makefile selects the Kubernetes node image.
2. Build and load the backend and issuer images. Load the pinned fork as `pki-manager-openbao:e2e`.
3. Deploy OpenBao in the `pki-manager` namespace. The fixture creates TLS credentials and
   persistent claims for Raft and bootstrap data. It initializes and unseals this test instance.
4. Deploy the backend. It reads the scoped token from Secret `pki-manager-backend-token`
   and the TLS CA from ConfigMap `openbao-client-ca`. Run the database migrations.
5. Install cert-manager and the issuer Helm chart.

The next steps create the signing CA and issue a certificate. The issuer sends the CSR to
`http://pki-manager-backend.pki-manager.svc.cluster.local:3000`. Only the backend calls
OpenBao at `https://openbao:8200`.

## Bootstrap CA + cluster token (post-install)

```bash
# Create the CA and read its ID.
CA_ID=$(kubectl -n pki-manager run -i --rm -q --restart=Never --image=curlimages/curl bootstrap --command -- \
  curl -fsS http://pki-manager-backend:3000/trpc/ca.create -H 'Content-Type: application/json' \
  -d '{"subject":{"commonName":"e2e-ca","organization":"Test","country":"ES"},"keyAlgorithm":"RSA-2048","validityYears":5}' | jq -er '.result.data.id')

# Register the Kubernetes integration and read its one-time token.
TOKEN=$(kubectl -n pki-manager run -i --rm -q --restart=Never --image=curlimages/curl regcluster --command -- \
  curl -fsS http://pki-manager-backend:3000/trpc/cluster.register -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg ca "$CA_ID" '{name:"in-cluster-e2e",caId:$ca}')" | jq -er '.result.data.token')

# Apply ClusterIssuer + Secret
cat <<EOF | kubectl apply --server-side -f -
apiVersion: v1
kind: Secret
metadata: { name: pki-manager-token, namespace: pki-manager-issuer }
type: Opaque
stringData: { token: $TOKEN }
---
apiVersion: pki-manager.issuer.io/v1alpha1
kind: ClusterIssuer
metadata: { name: pki-manager-default }
spec:
  url: http://pki-manager-backend.pki-manager.svc.cluster.local:3000
  caId: $CA_ID
  authSecretRef: { name: pki-manager-token, key: token }
  certificateType: dual
EOF

# Issue a cert
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: in-cluster-tls, namespace: default }
spec:
  secretName: in-cluster-tls
  issuerRef:
    group: pki-manager.issuer.io
    kind: ClusterIssuer
    name: pki-manager-default
  commonName: in-cluster.example.local
  dnsNames: [in-cluster.example.local]
  duration: 720h
  usages: [server auth, client auth]
EOF

# Approval is automatic: the issuer Helm chart installs an approver ClusterRole/Binding
# (approver.enabled=true, default) granting cert-manager's controller the `approve` verb on
# our signers, so the CertificateRequest is approved + issued without a manual patch.

# Wait for issuance and inspect the leaf and its issuer.
kubectl wait --for=condition=Ready --timeout=180s certificate/in-cluster-tls
kubectl get certificate,certificaterequest -n default
kubectl get secret in-cluster-tls -n default -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -subject -issuer -ext subjectAltName
```

## Check the chain and the leaf key

Run in Bash after the certificate becomes ready.

```bash
set -o pipefail
tls_field() {
  kubectl -n default get secret in-cluster-tls -o json | jq -er --arg f "$1" '.data[$f]' | base64 -d
}

openssl verify -CAfile <(tls_field ca.crt) <(tls_field tls.crt)
diff <(tls_field tls.crt | openssl x509 -noout -pubkey) <(tls_field tls.key | openssl pkey -pubout)
```

The first check verifies the certificate against the integration CA. The second compares the
public key of the certificate with the public part of the key that cert-manager generated.
Remove the fixture with `make kind-down`.

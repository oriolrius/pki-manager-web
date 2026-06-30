# Full In-Cluster E2E

Deploys PKI Manager backend + Cosmian KMS + cert-manager + the external issuer chart entirely inside a kind cluster.

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

This:
1. Creates kind cluster (`kindest/node:v1.31.2`)
2. Builds + loads `pki-manager-backend:e2e`, `pki-manager-issuer:e2e`, and pulls `ghcr.io/cosmian/kms:latest`
3. Applies namespace + KMS Deployment/Service + PKI Manager backend Deployment/Service/PVC
4. Runs DB migrations inside the backend pod
5. Installs cert-manager v1.16.2
6. Installs the issuer Helm chart

The backend signs CSRs via the KMS (the CA private key stays in the KMS), so no on-disk
CA cert/key is mounted — the CA is created in-cluster during bootstrap below.

## Bootstrap CA + cluster token (post-install)

```bash
# Create CA
kubectl -n pki-manager run -i --rm -q --restart=Never --image=curlimages/curl bootstrap -- sh -c "
  curl -s -X POST http://pki-manager-backend:3000/trpc/ca.create \
    -H 'Content-Type: application/json' \
    -d '{\"subject\":{\"commonName\":\"e2e-ca\",\"organization\":\"Test\",\"country\":\"ES\"},\"keyAlgorithm\":\"RSA-2048\",\"validityYears\":5}'
" > /tmp/ca.json
CA_ID=$(jq -r '.result.data.id' /tmp/ca.json)

# Register cluster (returns one-time token)
kubectl -n pki-manager run -i --rm -q --restart=Never --image=curlimages/curl regcluster -- sh -c "
  curl -s -X POST http://pki-manager-backend:3000/trpc/cluster.register \
    -H 'Content-Type: application/json' \
    -d '{\"name\":\"in-cluster-e2e\",\"caId\":\"'$CA_ID'\"}'
" > /tmp/reg.json
TOKEN=$(jq -r '.result.data.token' /tmp/reg.json)

# Apply ClusterIssuer + Secret
cat <<EOF | kubectl apply -f -
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

# Verify
kubectl get certificate,cr -n default
kubectl get secret in-cluster-tls -n default -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -subject -issuer -ext subjectAltName
```

## Network topology

```
kind cluster
├── ns: pki-manager
│   ├── cosmian-kms       Service :9998 → Pod :9998
│   └── pki-manager-backend Service :3000 → Pod :3000  (volume: PVC /data)
├── ns: cert-manager       (cert-manager 1.16.2)
└── ns: pki-manager-issuer (Helm chart, controller talks to ClusterIssuer.spec.url)
```

The issuer controller resolves `pki-manager-backend.pki-manager.svc.cluster.local:3000` purely via in-cluster DNS — no host network involvement.

## Verified outputs (2026-06-29, KMS-signed path)

- ClusterIssuer: `Ready=True, Reason=Verified`
- CertificateRequest: single CR `Approved=True (reason cert-manager.io)` **with no manual
  patch** (the chart's approver RBAC auto-approves), `Ready=True, Reason=Issued`
- Issued cert signed by the KMS-held CA (`issuer=CN=e2e-ca`); SAN + serverAuth/clientAuth EKU
  copied from the CSR; `basicConstraints critical CA:FALSE`
- Secret: `tls.crt` public key == `tls.key` (sha256 match) — the CSR's own key was preserved
  (the KMS did not regenerate it)
- Chain verifies: `openssl verify -CAfile ca.crt tls.crt` → OK

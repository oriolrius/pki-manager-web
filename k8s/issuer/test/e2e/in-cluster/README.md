# Full In-Cluster E2E

Deploys PKI Manager backend + Cosmian KMS + cert-manager + the external issuer chart entirely inside a kind cluster.

## Prerequisites
- `kind`, `kubectl`, `helm`, `docker`, `openssl`, `jq`

## One-shot

```bash
make e2e-in-cluster
```

This:
1. Creates kind cluster (`kindest/node:v1.31.2`)
2. Generates a test CA (`/tmp/e2e-ca.{crt,key}`)
3. Builds + loads `pki-manager-backend:e2e`, `pki-manager-issuer:e2e`, and pulls `ghcr.io/cosmian/kms:latest`
4. Applies namespace + KMS Deployment/Service + PKI Manager backend Deployment/Service/PVC + Secret with CA cert+key
5. Runs DB migrations inside the backend pod
6. Installs cert-manager v1.16.2
7. Installs the issuer Helm chart

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
│   └── pki-manager-backend Service :3000 → Pod :3000  (volumes: PVC /data, Secret /ca)
├── ns: cert-manager       (cert-manager 1.16.2)
└── ns: pki-manager-issuer (Helm chart, controller talks to ClusterIssuer.spec.url)
```

The issuer controller resolves `pki-manager-backend.pki-manager.svc.cluster.local:3000` purely via in-cluster DNS — no host network involvement.

## Verified outputs (2026-05-05)

- ClusterIssuer: `Ready=True, Reason=Verified`
- CertificateRequest: single CR `Ready=True, Reason=Issued`
- Secret: `tls.crt` and `tls.key` public-key sha256 match
- Chain verifies: `openssl verify -CAfile ca.crt tls.crt` → OK

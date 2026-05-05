# Install Guide

## Prerequisites

- Kubernetes 1.30+ (tested on 1.31, target 1.35)
- cert-manager 1.16+ installed in the cluster
- Network reachability from cluster to PKI Manager API
- A registered cluster in PKI Manager UI (yields a one-time token)

## 1. Register cluster in PKI Manager

1. Open PKI Manager UI → **Clusters** page
2. Click **Register Cluster**, select the CA, give it a name
3. Copy the displayed token. **It is shown once.**

## 2. Install controller via Helm

```bash
helm upgrade --install pki-manager-issuer \
  https://raw.githubusercontent.com/oriolrius/pki-manager-web/main/k8s/issuer/deploy/helm/pki-manager-issuer \
  --namespace pki-manager-issuer --create-namespace \
  --set image.tag=0.1.0
```

Or from a local clone:

```bash
cd k8s/issuer
helm upgrade --install pki-manager-issuer deploy/helm/pki-manager-issuer \
  -n pki-manager-issuer --create-namespace
```

## 3. Create Secret + ClusterIssuer

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: pki-manager-token
  namespace: pki-manager-issuer
type: Opaque
stringData:
  token: pkimg_<TOKEN_FROM_UI>
---
apiVersion: pki-manager.issuer.io/v1alpha1
kind: ClusterIssuer
metadata:
  name: pki-manager-default
spec:
  url: https://pki.your.domain
  caId: <CA_UUID_FROM_UI>
  authSecretRef:
    name: pki-manager-token
    key: token
  certificateType: dual
```

Apply and watch readiness:

```bash
kubectl apply -f clusterissuer.yaml
kubectl get clusterissuer.pki-manager.issuer.io pki-manager-default -o jsonpath='{.status.conditions}'
```

`Ready=True/Reason=Verified` means the controller has authenticated and matched CAID.

## 4. Issue a Certificate

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: example-tls
  namespace: default
spec:
  secretName: example-tls
  issuerRef:
    group: pki-manager.issuer.io
    kind: ClusterIssuer
    name: pki-manager-default
  commonName: example.cluster.local
  dnsNames: [example.cluster.local]
  duration: 2160h
  renewBefore: 360h
  usages: [server auth, client auth]
```

cert-manager creates a `CertificateRequest`; the controller signs it via PKI Manager and writes the chain into `Secret/example-tls` with `tls.crt`, `tls.key`, `ca.crt`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Issuer Ready=False, Reason=SecretMissing | Wrong namespace or key | ClusterIssuer secrets live in controller's namespace; use `key: token` |
| Reason=Unreachable | Network / TLS | Set `caBundle` if PKI Manager uses internal CA; check NetworkPolicy |
| Reason=CAIDMismatch | Token belongs to different CA | Re-register cluster in PKI Manager bound to the right CA |
| CertificateRequest stuck Pending=Approved? | cert-manager 1.16+ requires approval | RBAC for approver; default ApprovalController approves cert-manager-issued CRs only |
| 401 Unauthorized in controller logs | Token revoked or wrong | Re-register and rotate Secret |

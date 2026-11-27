# How PKI Manager signs Kubernetes (cert-manager) CSRs

**Status:** implemented. TASK-109.22 made the CSR path keep the requester's key; the OpenBao
cutover (decision-018) moved the signature to OpenBao Transit.

## Summary

When the cert-manager external issuer calls `POST /api/v1/external/sign`, PKI Manager builds a
certificate from the submitted CSR and asks OpenBao Transit to sign it with the key of the
cluster's CA. The CA private key stays in OpenBao. The issued certificate carries the **CSR's own
public key**: cert-manager makes the leaf key in the cluster, and only the CSR (the public key) is
sent to PKI Manager.

## CSR policy

The CSR may use RSA 2048-8192 or ECDSA P-256/P-384 keys; the backend verifies the CSR signature
before it builds the certificate. The subject may be empty (RFC 5280) when the CSR has at least
one SAN, as cert-manager Ingress certificates do; a CSR with neither a CN nor a SAN is rejected.
The extension policy (which CSR extensions are accepted, and which are refused) is in
[External integrations API](../api/integrations.md#backend-issuance-policy-and-failure-auditing).

## How the certificate is built

`rest/routes/external.routes.ts` calls `kms.signCertificate()` with the CSR and
`preserveCsrKey: true`. The key service builds the certificate in `crypto/x509-builder.ts`:

- version 3; `notBefore` is now, and `notAfter` is clamped to the days left on the CA
  certificate;
- a positive, random serial number of 20 octets;
- the subject, the public key and the requested extensions come from the CSR;
- the backend adds `basicConstraints=critical,CA:FALSE` (only when the CSR does not carry
  `basicConstraints`) and, when a CRL URL is configured, the `crlDistributionPoints` of the
  issuing CA. A backend extension replaces a CSR extension with the same OID, so no extension is
  duplicated;
- the issuer name is the subject of the CA certificate, byte for byte;
- the signature is `sha256WithRSAEncryption` for an RSA CA.

Transit signs the TBSCertificate with the pinned version of the CA key. The backend verifies the
certificate with the public key of the CA before it stores it.

The leaf certificate is stored with `source_type = 'k8s'`, `kms_key_id = NULL` (PKI Manager never
holds the leaf private key) and its `certificate_pem`. Signing is idempotent on `request_uid`.

## Trust / security notes

- The cluster CA's **private key is in OpenBao Transit**; the issuer controller never sees it.
  There is no on-disk CA key (`EXTERNAL_ISSUER_CA_KEY_PEM` was removed).
- One integration token is scoped to one CA (`integrations.ca_id`); an integration can only revoke
  certificates that it issued.
- keyUsage/EKU come from the cert-manager CSR (derived from the `Certificate` spec usages), so
  the certificate's purpose reflects the requester's intent. The API's `certificateType` field
  is recorded as metadata only on this path (`server`, `client` or `dual`; default `dual`).

## Requirements / caveats

- The cluster CA must be a PKI Manager CA whose key is in OpenBao. A CA that still references a
  Cosmian KMS object needs the OpenBao key migration first.

## Verifying

```bash
# route wiring (mocked key store): idempotency, storage, error paths
cd backend && pnpm exec vitest run src/rest/routes/external.routes.test.ts
```

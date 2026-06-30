# How PKI Manager signs Kubernetes (cert-manager) CSRs

**Status:** implemented (TASK-109.22). Supersedes the earlier offline node-forge approach.

## Summary

When the cert-manager external issuer calls `POST /api/v1/external/sign`, PKI Manager signs
the submitted CSR using the cluster's CA **inside the Cosmian KMS** via the KMIP `Certify`
operation. The CA private key never leaves the KMS, and the issued certificate carries the
**CSR's own public key** (cert-manager generates the leaf key in-cluster; only the CSR — i.e.
the public key — is ever sent to PKI Manager).

This replaces the previous strategy, where the KMS appeared to regenerate the key pair so we
signed offline with `node-forge` using a CA key supplied via `EXTERNAL_ISSUER_CA_CERT_PEM` /
`EXTERNAL_ISSUER_CA_KEY_PEM`. Those env vars and the offline path have been removed.

## Why the KMS path now works (root cause)

The earlier "Cosmian regenerates the key pair" conclusion was a wire-format bug, not a KMS
limitation. The KMIP 2.1 `Certify` payload carries the CSR in the **`CertificateRequestValue`**
field. Our client was sending it under the tag `CertificateRequest`, so the server silently
ignored the CSR and fell back to "Certify from Subject" mode (generate a fresh key from a
subject name). Sending the CSR under the correct tag makes the server take the CSR branch,
which signs the CSR's own public key.

Verified against Cosmian KMS 5.21.0 (see `backend/src/kms/spike-csr-certify.ts`):
- issued cert public key **==** CSR public key ✅
- the CSR's `subjectAltName`, `keyUsage`, and `extKeyUsage` are copied into the cert ✅
- no duplicate extensions ✅

## How the request is built

`backend/src/kms/client.ts` → `certify()` / `service.ts` → `signCertificate()`:

- `csr`: the PEM CSR, sent as `CertificateRequestValue` (ByteString) + `CertificateRequestType: PEM`.
- `preserveCsrKey: true`: omits `CryptographicAlgorithm`/`CryptographicLength` (the KMIP
  "generate a key pair" signal). On 5.21 the CSR branch returns before key generation, so this
  is belt-and-suspenders; it documents intent and protects against other versions.
- `issuerCertificateId`: the cluster CA's `kms_certificate_id`. The KMS resolves the issuer
  private key from that certificate's links and signs — the key stays in the KMS.
- `x509Extensions`: **only** `basicConstraints=critical,CA:FALSE`. Cosmian copies the CSR's
  own `subjectAltName`/`keyUsage`/`extKeyUsage`, and OpenSSL's `append_extension` does **not**
  dedupe — so re-supplying those here would produce duplicate, invalid extensions. CSRs never
  carry `basicConstraints`, so adding `CA:FALSE` is safe and yields a proper end-entity cert.

The leaf certificate is stored with `source_type = 'k8s'`, a real `kms_certificate_id`,
`kms_key_id = NULL` (PKI Manager never holds the leaf private key), and a cached
`certificate_pem`. Signing is idempotent on `request_uid`.

## Trust / security notes

- The cluster CA's **private key is held only in the KMS**; PKI Manager and the issuer
  controller never see it. There is no longer an on-disk CA key (`EXTERNAL_ISSUER_CA_KEY_PEM`).
- One cluster token is scoped to one CA (`clusters.ca_id`); a cluster can only revoke certs it issued.
- keyUsage/EKU come from the cert-manager CSR (derived from the `Certificate` spec usages), so
  the certificate's purpose reflects the requester's intent. The API's `certificateType` field
  is recorded for display only on this path.

## Requirements / caveats

- The cluster CA must have been created **in the KMS** (the normal CA-creation flow) so that
  `kms_certificate_id` resolves to a KMS certificate with a usable issuer private-key link.
- Verified on Cosmian KMS **5.21.0**. The `CertificateRequestValue` tag is the KMIP 2.1 field
  name; if you pin an older server, re-run `backend/src/kms/spike-csr-certify.ts` to confirm.

## Verifying

```bash
# 1) start a KMS (default-config container works; the committed kms/docker-compose.yml needs a fix
#    for current :latest — see TASK-109.22 notes)
docker run -d --name kms -p 42998:9998 ghcr.io/cosmian/kms:latest

# 2) end-to-end KMS behaviour (key preservation + extension fidelity)
cd backend && KMS_URL=http://localhost:42998 pnpm exec tsx src/kms/spike-csr-certify.ts

# 3) route wiring (mocked KMS): idempotency, storage, error paths
cd backend && pnpm exec vitest run src/rest/routes/external.routes.test.ts
```

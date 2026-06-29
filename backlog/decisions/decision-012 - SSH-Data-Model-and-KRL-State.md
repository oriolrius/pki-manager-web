---
id: decision-012
title: SSH Data Model and KRL State
date: '2026-06-29 15:48'
status: Proposed
---
## Context

OpenSSH "CAs" and certificates are a fundamentally different object than X.509: no X.509 cert,
no DN, no SAN, no CRL distribution points; instead an OpenSSH-wire public key, monotonic uint64
serials, principals lists, and extensions/critical-options. Overloading the existing
`certificate_authorities` / `certificates` tables with a discriminator would force every X.509
query to special-case SSH and risk regressions. The KRL trust model is also subtle: OpenSSH
RevokedKeys files are NATIVELY UNSIGNED — sshd does NOT verify any signature on a KRL
(technical-reference §7.1) — so a "CA-signed KRL served as RevokedKeys" must not be framed as if
sshd enforced the signature. This decision settles the SSH data model so SSH-05..SSH-09
(TASK-122..126) and the KRL tasks (SSH-20/21/22/24) do not re-litigate it.

## Decision

- **New `ssh_*` tables**, not a discriminator on the X.509 tables: `ssh_cas` (caType
  user|host, rotation columns), `ssh_hosts` (+ KRL/principal telemetry), `ssh_identities`,
  `ssh_certificates`, `ssh_principals` + `ssh_user_principals` + `ssh_host_principal_maps`,
  `ssh_revocations`, `ssh_krls`. The X.509 tables and queries are untouched.
- **Verbatim signed blobs on-row**: `ssh_certificates.cert_openssh` stores the signed
  `*-cert.pub` bytes verbatim, exactly as `crls.crl_pem` does, because the KMS produces no such
  object and re-signing is non-deterministic (random nonce). Downloads return the stored bytes.
- **Two-artifact KRL trust model**: `ssh_krls.krl_blob` is the BARE UNSIGNED OpenSSH KRL that
  sshd reads via RevokedKeys (integrity on the public path = TLS + 0444 root-owned file perms,
  documented honestly); a DISTINCT `ssh_krls.ca_signature` column holds the detached CA
  signature verified ONLY by the optional custom puller, never by sshd.
- **ONE serial scheme**: a per-CA monotonic counter (`ssh_cas.next_serial`, allocated
  transactionally) used consistently by both the UI and automation — the PoC's unix-timestamp
  serials are NOT mixed in. Serials are stored/handled as uint64 (TEXT / bigint).
- **Key-id convention**: a printable, control-char-free human anchor (e.g.
  `<fqdn>-<date>-<serial>` for hosts, the named identity for users), logged verbatim by sshd.
- **Serial-RANGE revocation is OUT of v1 scope**: revoke by explicit serial or by key SHA256
  fingerprint only; serial gaps from the monotonic allocator make ranges an over-revocation
  foot-gun.
- `audit_log` is reused unchanged; only the `AuditOperation` / `AuditEntityType` unions in
  `lib/audit.ts` grow (no audit_log migration). Status stays Proposed pending SSH-09 landing.

## Consequences

- X.509 behaviour is fully isolated from SSH; SSH migrations are purely additive and a kill
  switch can disable the SSH router without affecting X.509.
- Stable re-download and stable If-None-Match/304 caching follow from verbatim on-row blobs.
- The honest UNSIGNED-bare-KRL framing prevents a false sense of sshd-enforced KRL signing and
  scopes the detached signature to the puller path only.
- A single serial scheme keeps serial reasoning correct across UI + Ansible + CI issuance.

## Related tasks

- TASK-122..126 (SSH-05..SSH-09) — the ssh_* schema, serial allocator, and this decision.
- TASK-140..142 / TASK-145 (SSH-20/21/22/24) — consume the bare-KRL + detached-signature split.

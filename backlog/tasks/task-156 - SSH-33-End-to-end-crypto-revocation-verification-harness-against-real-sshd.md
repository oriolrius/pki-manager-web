---
id: TASK-156
title: 'SSH-33: End-to-end crypto + revocation verification harness against real sshd'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:46'
updated_date: '2026-06-29 18:39'
labels:
  - ssh-cert-manager
  - automation
  - testing
milestone: SSH Certificate Manager
dependencies:
  - TASK-129
  - TASK-130
  - TASK-131
  - TASK-142
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Vitest integration suite (gated on ssh-keygen/sshd availability, skipping cleanly in CI when absent, mirroring the PoC poc.sh UC1-UC9) that creates a dual KMS CA, signs host and user certs through the services, and asserts against a real sshd: no-TOFU host login via @cert-authority (StrictHostKeyChecking=yes), principal-based RBAC (principal 'admin' logs in as root via AuthorizedPrincipalsFile, 'developer' does not), permit-pty denial via cleared extensions ('PTY allocation request failed'), force-command override, source-address denial AND rejection of a malformed CIDR at issuance, expiry rejection, and revocation (revoke a key, rebuild+serve the BARE KRL, host installs RevokedKeys, sshd logs 'revoked by file' and the key can no longer authenticate — confirming sshd honours the unsigned KRL bytes, not any signature). Proves the TS encoder/signer/KRL are byte-compatible with OpenSSH.

**Epic:** Automation, Ops, Docs & E2E
**Logical deps:** SSH-11, SSH-12, SSH-13, SSH-22
**Touchpoints:** backend/src/crypto/ssh/e2e.test.ts, backend/test/ssh/, backend/src/services/ssh-krl.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host cert signed by our service makes ssh connect with StrictHostKeyChecking=yes via @cert-authority (no TOFU prompt); a user cert with principal 'admin' logs in as root while 'developer' does not
- [ ] #2 A cert with cleared extensions runs a remote command but is denied an interactive PTY; force-command override is honoured; a malformed source-address CIDR is rejected at issuance; an expired cert is rejected
- [ ] #3 Revoking a key, rebuilding and serving the BARE KRL, and installing it on the host causes sshd to deny that key ('revoked by file') with the prior cert previously working — confirming the unsigned bytes are honoured
- [ ] #4 The suite skips cleanly (not fails) when ssh-keygen/sshd are unavailable, and all KMS-touching tests skip when KMS_URL is unreachable
<!-- AC:END -->

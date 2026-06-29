---
id: TASK-145
title: 'SSH-24: Stateless encrypted KRL distribution sidecar + host-side puller'
status: To Do
assignee: []
created_date: '2026-06-29 15:44'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - revocation
  - kms
milestone: SSH Certificate Manager
dependencies:
  - TASK-144
  - TASK-142
  - TASK-138
  - TASK-133
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
v1 scope, gated on SSH-23 proving ECIES viable (external-pubkey Register + locate-by-tag + ec encrypt/decrypt for nistp256). If SSH-23 proves ECIES viable: productise services/krl-distributor as a stateless, secret-free sidecar. POST /api/v1/external/ssh/krl {host_id} + If-None-Match: validate host_id grammar, fetch the bare KRL + detached ca_signature + version from the backend authenticated endpoint, locate the host pubkey by tag, ECIES-encrypt the inner payload {krl, ca_signature, krl_version, valid_until, host_id} to it, return 304/200 + X-KRL-Version. Ship the host-side puller (systemd .service/.timer): decrypt with the host's own KMS key, verify CA signature (SSH-04 pinned format) + valid_until + host_id binding + sha256==advertised version + ANTI-ROLLBACK (refuse a krl_version/krl_number not strictly newer than the installed one), then atomically install -m444 to /etc/ssh/revoked_keys. The puller POSTs an authenticated callback recording host_id + installed version so ssh_hosts telemetry (SSH-06) is populated. NTP is documented as a hard host prerequisite for both temporal cert validity and KRL freshness. If ECIES is unviable (SSH-23), this whole task is dropped (not degraded) and the sidecar is not built.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-23, SSH-22, SSH-19, SSH-15
**Touchpoints:** services/krl-distributor/, docker/docker-compose.yml, docker/Dockerfile
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A registered host POSTing /krl with a stale If-None-Match receives 200 ECIES ciphertext it can decrypt with its own private key; an up-to-date If-None-Match receives 304 + X-KRL-Version; an unregistered host_id returns 404 and a malformed one 400
- [ ] #2 The puller refuses to install a payload whose CA signature fails, whose valid_until is past, whose host_id mismatches, whose sha256 differs from the advertised version, OR whose version is not strictly newer than the installed one (anti-rollback); otherwise installs atomically -m444 and exits 0 (no write on the 304 path)
- [ ] #3 After central revocation and a timer fire, that key can no longer authenticate and sshd logs 'revoked by file'; the puller's authenticated callback populates ssh_hosts.last_krl_version/last_krl_fetch_at
- [ ] #4 The sidecar holds no secrets, delegates all crypto to KMS, returns 503 if the backend KRL endpoint is down (never an unsigned/empty KRL); if SSH-23 finds ECIES unviable this task is dropped entirely
<!-- AC:END -->

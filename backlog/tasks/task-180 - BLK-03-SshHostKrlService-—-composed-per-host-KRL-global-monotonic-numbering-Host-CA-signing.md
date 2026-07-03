---
id: TASK-180
title: >-
  BLK-03: SshHostKrlService — composed per-host KRL + global monotonic numbering
  + Host-CA signing
status: To Do
assignee: []
created_date: '2026-07-03 21:24'
labels:
  - ssh-host-blocks
  - backend
  - revocation
  - kms
milestone: SSH Host Access Blocks
dependencies:
  - TASK-179
references:
  - backend/src/services/ssh-krl.service.ts
  - backend/src/crypto/ssh/krl.ts
priority: high
ordinal: 7014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
generate(hostId) composes: KRL(host) = host-CA revocation set UNION all user-CA revocation sets UNION resolve(active blocks on host), using the existing builder (multiple CA-scoped CERT_SERIAL_LIST sections + SECTION_FINGERPRINT_SHA256 in one blob — verified supported, crypto/ssh/krl.ts:49-76).

resolve(identity) at build time = (a) serials of all not-yet-expired certs of that identity, grouped by EACH cert's issuing-CA key blob REGARDLESS of CA status (a blocked cert issued by a since-retired/rotated CA must keep its serial section; fingerprints are only belt-and-braces), + (b) SHA256 fingerprints of every pubkey ever certified for it (ssh_certificates.subject_pubkey_fingerprint via fingerprintToHash, ssh-krl.service.ts:38-46).

NUMBERING — load-bearing (pinned req #4 + TASK-175): allocation is GLOBALLY MONOTONIC and transactional: number = max(all ssh_krls lineages, all ssh_host_krls lineages) + 1, allocated inside a better-sqlite3 transaction (or insert-retry on the BLK-02 unique index). This (a) guarantees the first per-host KRL exceeds any per-CA number a host has installed (cutover accept), (b) removes the cross-lineage read-then-insert race (two rows with the same header number = client rejects the later one as rollback = silent block loss), (c) makes switch-back/rollback monotonic by construction. Apply the same global seeding to per-CA generate() (ssh-krl.service.ts:128-131).

SIGNING: Host-CA kmsKeyId via signRaw (pinned req #1 — trust-anchor reconciliation with krl-client is BLK-10). On signRaw failure: row persists with ca_signature null per decision req #3 (host_puller.sh installs it; krl-client fail-stales on last-good until re-signed — surfaced as a distinct state by BLK-07, documented by BLK-12). block_count persisted from the resolved active-block set. Audit ssh.host_krl.generate on success AND failure (project convention); AuditOperation type extension lands here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Unit: composed blob contains the host-CA serial section, every user-CA section, block serials grouped per issuing CA including a retired-CA case, and fingerprint entries — verified by decoding (ssh-keygen -Q cross-check where available)
- [ ] #2 Concurrency test: parallel per-CA + per-host generations yield strictly increasing unique numbers; first per-host number > max per-CA number
- [ ] #3 signRaw failure: row persists unsigned, failure audited, subsequent successful generate() produces a signed row
- [ ] #4 block_count persisted; ssh.host_krl.generate audited on success and failure
<!-- AC:END -->

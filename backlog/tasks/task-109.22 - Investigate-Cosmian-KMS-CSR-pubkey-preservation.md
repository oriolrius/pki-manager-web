---
id: TASK-109.22
title: Investigate Cosmian KMS CSR-pubkey preservation
status: To Do
assignee: []
created_date: '2026-05-05 17:48'
labels:
  - backend
  - kms
dependencies: []
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cosmian KMS 5.20 .certify() with CSR field set still generates a fresh keypair, ignoring CSR public key. Need either: (a) KMIP Register operation to import CSR pubkey then certify with publicKeyId+Link, or (b) different KMS attribute set that signals 'reuse CSR key', or (c) accept current offline-signing fallback as production strategy. Investigate Cosmian docs / file upstream issue.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Document chosen approach in docs/
- [ ] #2 If KMIP Register: implement importPublicKey wrapper
- [ ] #3 If offline: lock down EXTERNAL_ISSUER_CA_KEY_PEM permissions, document threat model
<!-- AC:END -->

---
id: TASK-152
title: 'SSH-31: Ansible ssh_host_cert role + SSH API contract docs'
status: To Do
assignee: []
created_date: '2026-06-29 15:45'
labels:
  - ssh-cert-manager
  - automation
  - docs
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port the PoC's Ansible ssh_host_cert role into the repo (Jan-Piet Mens pattern): Ed25519 host key generated ON the node (never leaves it), only the pubkey copied to the controller, signed via POST /api/v1/external/ssh/sign-host with a fleet bearer token, cert pushed back, sshd_config drop-in installed + sshd -t validated + reloaded. Host-pubkey registration (POST /register-host-pubkey) is included ONLY when the ECIES path is enabled (SSH-15/23). Author docs/ssh-api-contract.md documenting every external endpoint, the Idempotency-Key contract, the per-fleet bearer auth model, the standard error shape, the public /krl endpoints AND the bare-KRL-unsigned trust model (sshd does not verify the signature), and which endpoints are token-scoped vs public with retryability semantics.

**Epic:** Automation, Ops, Docs & E2E
**Logical deps:** SSH-19, SSH-22
**Touchpoints:** ansible/roles/ssh_host_cert/, docs/ssh-api-contract.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The ssh_host_cert role generates the host key on the node, signs the pubkey via the external API with a bearer token over TLS, installs the cert + sshd drop-in, runs sshd -t, and reloads sshd; host-pubkey registration is invoked only when the ECIES path is enabled
- [ ] #2 docs/ssh-api-contract.md documents every SSH external endpoint with request/response schemas, the Idempotency-Key contract, the per-fleet bearer auth model, the standard error shape, and the bare-KRL-unsigned vs detached-signature trust model
- [ ] #3 The role's HTTP calls map 1:1 to documented endpoints and the contract states which endpoints are token-scoped vs public and their retryability
- [ ] #4 An operator can retrieve the OpenSSH CA trust bundle (@cert-authority + TrustedUserCAKeys lines) from one documented public endpoint
<!-- AC:END -->

---
id: TASK-147
title: >-
  SSH-26: SSH CAs: list + create/import dual CA + detail with trust-material
  generators
status: Done
assignee: []
created_date: '2026-06-29 15:44'
updated_date: '2026-06-29 19:00'
labels:
  - ssh-cert-manager
  - frontend
milestone: SSH Certificate Manager
dependencies:
  - TASK-146
  - TASK-135
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pages to manage the dual SSH CA. List shows the two CA roles with OpenSSH fingerprints, status (incl. 'rotating'), created date. Create flow provisions a User CA and Host CA, offering only ECDSA nistp256 with an inline explanation (PKCS#11 v2.40 / Cosmian compatibility); an Import flow adopts an existing CA (SSH-IMPORT). Detail uses DeployPanel to expose all trust material: the OpenSSH public key (copy + download .pub), a @cert-authority known_hosts line with an EDITABLE host/IP pattern input (warning that '*.example.com' fails when connecting by IP), and a TrustedUserCAKeys server drop-in; during rotation it shows BOTH predecessor and successor keys. Empty-state CTAs guide operators to create the dual CA first. Reuses trpc.ssh.ca.* with mutation→invalidate→navigate.

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** SSH-25, SSH-17
**Touchpoints:** frontend/src/routes/ssh.cas.tsx, frontend/src/routes/ssh.cas.new.tsx, frontend/src/routes/ssh.cas.$id.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator can create OR import a dual SSH CA and lands on a detail view showing both OpenSSH public keys; the form offers only ECDSA nistp256 and explains why inline
- [x] #2 For a Host CA, the operator can copy a correct '@cert-authority <pattern> ecdsa-sha2-nistp256 AAAA...' line where the pattern is editable and IP-vs-glob mismatch is warned; during rotation both keys are shown
- [x] #3 For a User CA, the operator can copy/download a TrustedUserCAKeys-ready public key file and an sshd_config drop-in referencing it, and download the CA public key as a .pub
- [x] #4 If no SSH CA exists, Hosts/Users/Principals/KRL pages guide the operator to create the dual CA first; backend errors surface inline without crashing
<!-- AC:END -->

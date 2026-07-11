---
id: TASK-202
title: 'ANS-09: Stretch: X.509 CA trust-anchor install + CRL refresh cron (non-SSH)'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 09:55'
labels:
  - ansible
  - ansible-integration
  - stretch
  - x509
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: low
ordinal: 29014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Low-priority parallel of the SSH trust install for X.509 peers. Fetch the CA cert from the public GET /cas/:caId.pem (server.ts:55) into the OS trust store and run update-ca-certificates/update-ca-trust, and reuse the existing tmp-write+mv cron pattern (tasks/main.yml:138-148) against the public GET /crl/:caId.crl (public-crl.routes.ts:20-113) to keep a local CRL fresh. Both gated off by default. Keep out of the SSH critical path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When enabled, the CA cert lands in the host trust store and 'openssl verify' against it succeeds for a leaf issued by that CA
- [ ] #2 A cron refreshes /etc/.../<caId>.crl atomically from the public endpoint and the file parses as a valid DER/PEM CRL
- [ ] #3 Both features are disabled by default and a second run is idempotent
<!-- AC:END -->

---
id: TASK-109.25
title: Clean up dead offline-signing config + fix kms docker-compose for latest image
status: To Do
assignee: []
created_date: '2026-06-29 12:14'
labels:
  - k8s
  - cleanup
  - devops
dependencies: []
parent_task_id: TASK-109
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-ups from TASK-109.22 (which moved /sign to KMS signing):
1. k8s/issuer/test/e2e/in-cluster/20-pki-manager.yaml still injects the now-unused EXTERNAL_ISSUER_CA_CERT_PEM/_KEY_PEM env + /ca volume mount. Remove them (the backend no longer reads them) and confirm the in-cluster e2e still issues a cert.
2. kms/docker-compose.yml crash-loops against the current ghcr.io/cosmian/kms:latest: "Configuration file found at the default path (/etc/cosmian/kms.toml) but extra command-line arguments were also provided." Fix so the dev KMS boots (e.g. set COSMIAN_KMS_CONF, drop the conflicting args, or pin a compatible tag).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 20-pki-manager.yaml no longer references EXTERNAL_ISSUER_CA_* or the /ca mount, and the in-cluster e2e still issues a certificate
- [ ] #2 cd kms && docker compose up -d brings up a healthy KMS against the current image (curl :42998/version succeeds)
<!-- AC:END -->

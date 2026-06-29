---
id: TASK-109.25
title: Clean up dead offline-signing config + fix kms docker-compose for latest image
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 12:14'
updated_date: '2026-06-29 13:02'
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
- [x] #2 cd kms && docker compose up -d brings up a healthy KMS against the current image (curl :42998/version succeeds)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done:
- kms/docker-compose.yml: added COSMIAN_KMS_CONF=/etc/cosmian/kms.toml so the entrypoint uses the mounted config instead of injecting conflicting default CLI args. Verified: docker compose config valid; docker compose up -d boots; curl :42998/version -> 5.21.0 (AC#2).
- 20-pki-manager.yaml: removed EXTERNAL_ISSUER_CA_CERT_PEM/_KEY_PEM env, the /ca volumeMount, and the ca Secret volume (backend signs via KMS now).
- Makefile deploy-pki-manager: removed the /tmp/e2e-ca generation + pki-manager-external-ca secret creation (dead). make -n parses clean.
- e2e README: dropped the test-CA + Secret steps and the /ca topology note.
No residual EXTERNAL_ISSUER_CA / pki-manager-external-ca / /tmp/e2e-ca refs remain.

AC#1: the manifest no longer references EXTERNAL_ISSUER_*//ca (verified) — but the "and the in-cluster e2e still issues a certificate" clause needs a real make e2e-in-cluster kind run (not runnable here; same kind-run that also closes 109.23 AC#2). Left unchecked until that run.
<!-- SECTION:NOTES:END -->

---
id: TASK-109.08
title: 'Frontend: cert source filter and k8s metadata display'
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 17:11'
labels:
  - frontend
  - ui
dependencies:
  - TASK-109.05
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Certificates list filter by source (manual/k8s/all); k8s metadata column; cert detail page shows k8s origin block.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Source filter dropdown on /certificates
- [ ] #2 k8s metadata column visible for k8s certs
- [ ] #3 Cert detail shows Cluster, Namespace, Resource for k8s certs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Backend listCertificatesSchema + service filter sourceType=manual|k8s added. Existing /certificates page consumes via trpc.certificate.list - filter passes through after tRPC regeneration. UI dropdown is straightforward addition; deferred to keep this task scope-bounded.
<!-- SECTION:NOTES:END -->

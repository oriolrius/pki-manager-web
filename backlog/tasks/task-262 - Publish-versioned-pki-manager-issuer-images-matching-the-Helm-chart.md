---
id: TASK-262
title: Publish versioned pki-manager-issuer images matching the Helm chart
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-24T10:18:00Z'
updated_date: '2026-11-24T14:42:00Z'
labels:
  - k8s
  - bug
dependencies: []
ordinal: 82014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The chart default image tag is the chart appVersion (0.1.0), but CI publishes only short-SHA and latest tags, so a default helm install fails with ErrImagePull (found while writing the docs k8s guide, 2026-11-24).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A helm install with default values pulls an image that exists
- [ ] #2 Each release publishes an issuer image tag that matches the chart appVersion
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/21
<!-- SECTION:NOTES:END -->

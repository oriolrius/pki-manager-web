---
id: TASK-109.16
title: Container image build and multi-arch CI
status: Done
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 17:11'
labels:
  - deployment
  - ci
dependencies:
  - TASK-109.13
documentation:
  - 'https://github.com/GoogleContainerTools/distroless'
  - 'https://docs.sigstore.dev/cosign/signing/signing_with_containers/'
  - 'https://github.com/anchore/syft'
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Distroless base, non-root, multi-stage Dockerfile. GH Actions: build amd64+arm64, push to ghcr.io, sign with cosign, SBOM via syft.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Image runs as non-root on distroless static base
- [ ] #2 Multi-arch image (amd64, arm64) on ghcr.io
- [ ] #3 Image signed with cosign and SBOM attached
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
.github/workflows/k8s-issuer.yml: go vet + test, buildx multi-arch (amd64+arm64), push to ghcr.io on main, cosign keyless OIDC sign, syft SBOM, helm lint + template.
<!-- SECTION:NOTES:END -->

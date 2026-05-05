---
id: TASK-109.16
title: Container image build and multi-arch CI
status: To Do
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 16:23'
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
Base: gcr.io/distroless/static-debian12:nonroot. Sign with cosign keyless (OIDC GH Actions). SBOM via syft attached as cosign attestation.
<!-- SECTION:NOTES:END -->

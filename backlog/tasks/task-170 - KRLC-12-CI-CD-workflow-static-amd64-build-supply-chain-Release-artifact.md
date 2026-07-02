---
id: TASK-170
title: 'KRLC-12: CI/CD workflow - static amd64 build + supply chain + Release artifact'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:15'
updated_date: '2026-07-02 16:04'
labels:
  - ssh-cert-manager
  - automation
  - ci
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-169
priority: high
ordinal: 12
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add .github/workflows/krl-client.yml. Triggers: push branches:[main] paths:['krl-client/**','.github/workflows/krl-client.yml'] + tags:['v*.*.*']; pull_request on the same paths; workflow_dispatch. CI job (setup-go@v5 go-version '1.26', cache on krl-client/go.sum, working-directory krl-client): go mod download, go vet ./..., go test ./... -race -covermode=atomic -coverprofile=coverage.out -count=1, upload coverage via actions/upload-artifact@v4. Release job (if startsWith(github.ref,'refs/tags/v'); permissions contents:write id-token:write): build the static CGO_ENABLED=0 GOOS=linux GOARCH=amd64 binary (-trimpath -ldflags '-s -w -X main.version=${GITHUB_REF_NAME}'), sha256 checksums.txt, sigstore/cosign-installer@v3 + cosign sign-blob (keyless), anchore/sbom-action@v0 SPDX SBOM, and softprops/action-gh-release@v2 attaching binary+checksums+sig+cert+SBOM. Version rides the cz-bump vX.Y.Z tag.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On push/PR touching krl-client/**, CI runs go vet and go test -race with coverage and uploads coverage.out as an artifact
- [x] #2 On a vX.Y.Z tag the release job produces krl-client-linux-amd64 (static CGO-disabled amd64, version stamped from GITHUB_REF_NAME), checksums.txt, a cosign .sig+.pem, and an SPDX SBOM, all attached to the GitHub Release for that tag
- [x] #3 The workflow mirrors k8s-issuer.yml setup-go/cosign/syft style and reuses docker-build.yml v*.*.* tag trigger; the release binary builds with CGO_ENABLED=0 even though tests use -race
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add .github/workflows/krl-client.yml with push(branches:main+paths, tags:v*.*.*)/pull_request(paths)/workflow_dispatch triggers
2. ci job: setup-go@v5 (1.26, cache krl-client/go.sum, wd krl-client) -> go mod download, go vet ./..., go test -race -covermode=atomic -coverprofile -count=1 -> upload coverage.out via upload-artifact@v4
3. release job: needs ci, if refs/tags/v*, permissions contents:write id-token:write -> make build-static VERSION=GITHUB_REF_NAME (CGO_ENABLED=0 static amd64) -> sha256 checksums.txt -> cosign-installer@v3 sign-blob keyless (.sig+.pem) -> anchore/sbom-action@v0 spdx-json SBOM -> softprops/action-gh-release@v2 attach binary+checksums+sig+cert+SBOM
4. Mirror k8s-issuer.yml setup-go/cosign/syft style; reuse docker-build.yml v*.*.* tag trigger
5. Validate YAML (actionlint if available) + locally prove go vet/test-race and make build-static succeed
<!-- SECTION:PLAN:END -->

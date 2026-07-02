---
id: TASK-159
title: 'KRLC-01: Scaffold krl-client Go module, flat layout, Makefile'
status: To Do
assignee: []
created_date: '2026-07-01 07:13'
updated_date: '2026-07-02 07:59'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH KRL Client Distribution
dependencies: []
priority: high
ordinal: 1
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the new top-level Go module krl-client/ (module github.com/oriolrius/pki-manager-krl-client, go 1.26) with a flat layout: main.go at root (no cmd/), empty internal/{config,krlclient,decrypt,payload,verify,installer,state,logx,app} package skeletons, and a Makefile mirroring k8s/issuer/Makefile (build, test, fmt, vet, tidy, build-static with CGO_ENABLED=0 GOOS=linux GOARCH=amd64 -trimpath -ldflags '-s -w -X main.version=$(VERSION)'). main.go exposes a -ldflags-injected `var version string` and a working --version flag. Target the LATEST Go (1.26) - an intentional divergence from k8s/issuer (Go 1.23), validated by the KRLC-02a spike; this lets the client use stdlib crypto/hkdf (Go 1.24+) and the latest golang.org/x/crypto (the only external dep is x/crypto/ssh, for OpenSSH host-key parsing). No cmd/ dir (matches the issuer convention).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 make build and make vet succeed from inside krl-client/, producing a binary whose --version prints the value injected via -ldflags -X main.version=... (dev/empty when unset)
- [ ] #2 make build-static emits dist/krl-client-linux-amd64 that file(1) reports as a statically linked ELF amd64 executable with no dynamic dependencies
- [ ] #3 go.mod declares module github.com/oriolrius/pki-manager-krl-client at go 1.23.0 and every internal/* package skeleton compiles
<!-- AC:END -->

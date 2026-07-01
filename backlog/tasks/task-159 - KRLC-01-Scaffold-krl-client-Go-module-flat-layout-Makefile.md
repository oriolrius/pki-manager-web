---
id: TASK-159
title: 'KRLC-01: Scaffold krl-client Go module, flat layout, Makefile'
status: To Do
assignee: []
created_date: '2026-07-01 07:13'
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
Create the new top-level Go module krl-client/ (module github.com/oriolrius/pki-manager-krl-client, go 1.23.0), a peer to k8s/issuer/. Flat layout: main.go at the module root (no cmd/), plus internal/{config,krlclient,decrypt,payload,verify,installer,state,logx,app} package skeletons, and a Makefile mirroring k8s/issuer/Makefile (build, test, fmt, vet, tidy, and build-static: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '-s -w -X main.version=$(VERSION)'). main.go exposes a -ldflags-injected `var version string` and a working --version flag. This is the productionization of the SSH-24 host-side puller (TASK-145) into a standalone, shippable single-binary agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 make build and make vet succeed from inside krl-client/, producing a binary whose --version prints the value injected via -ldflags -X main.version=... (dev/empty when unset)
- [ ] #2 make build-static emits dist/krl-client-linux-amd64 that file(1) reports as a statically linked ELF amd64 executable with no dynamic dependencies
- [ ] #3 go.mod declares module github.com/oriolrius/pki-manager-krl-client at go 1.23.0 and every internal/* package skeleton compiles
<!-- AC:END -->

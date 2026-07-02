---
id: TASK-174
title: >-
  krl-client: cap the 200-response body size (bound io.ReadAll on the ECIES
  envelope)
status: To Do
assignee: []
created_date: '2026-07-02 16:43'
labels:
  - ssh-cert-manager
  - krl-client
  - security
dependencies: []
ordinal: 1014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-release security review (v3.4.0) found the 200-response ECIES body is read with an unbounded io.ReadAll at krl-client/internal/krlclient/http.go:112, while the error path already caps at 1KB via io.LimitReader. A compromised/malicious backend (or MITM under --insecure) can stream a multi-GB body and OOM krl-client, which runs as root from cron/systemd. Not a release blocker (needs server compromise or --insecure; TLS-verified by default), but a defense-in-depth hardening item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The 200-response body is bounded by io.LimitReader/http.MaxBytesReader at a sane envelope ceiling (a few MB), and an oversized response is rejected with a clear error rather than buffered
- [ ] #2 A unit test asserts an over-limit response is rejected without unbounded allocation
<!-- AC:END -->

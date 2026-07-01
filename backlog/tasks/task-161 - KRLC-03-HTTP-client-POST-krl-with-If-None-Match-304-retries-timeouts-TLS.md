---
id: TASK-161
title: >-
  KRLC-03: HTTP client - POST /krl with If-None-Match/304, retries, timeouts,
  TLS
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-159
priority: high
ordinal: 3
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/krlclient: POST {server-url}/api/v1/external/ssh/krl with Content-Type: application/json and body {"host_id":"<host-id>"}; when a cached version exists, send If-None-Match set to that verbatim krl_version token (the 'sha256:...' string echoed from the previous 200 X-KRL-Version header - NOT a sha256 of the local file, correcting the prototype). Read X-KRL-Version on responses. Configurable TLS (RootCAs from --ca-bundle, InsecureSkipVerify only under --insecure), per-request --timeout via context, and bounded --retries with exponential backoff on transport errors and 5xx. Map 200/304/400/404/429/500/501/503 to typed results carrying the intended exit code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Against a fake server, a first request sends NO If-None-Match and yields the 200 body + X-KRL-Version; a follow-up echoes that exact 'sha256:...' token as If-None-Match and yields a 304 with no body
- [ ] #2 The client maps 400->exit9, 404->exit9, 429->exit10, 501->exit9, 503->exit2, 500->exit2, and retries transport/5xx up to --retries with backoff before failing exit2
- [ ] #3 TLS verification is enforced by default (an untrusted cert fails), pinnable via --ca-bundle or bypassable only with --insecure; --timeout aborts a hung request
<!-- AC:END -->

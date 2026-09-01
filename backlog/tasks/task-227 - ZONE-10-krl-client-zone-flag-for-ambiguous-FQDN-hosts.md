---
id: TASK-227
title: 'ZONE-10: krl-client --zone flag for ambiguous-FQDN hosts'
status: To Do
assignee: []
created_date: '2026-09-01 04:49'
updated_date: '2026-09-01 05:44'
labels:
  - ssh-zones
  - ssh-cert-manager
  - krl-client
  - go
milestone: SSH Zones
dependencies:
  - TASK-226
ordinal: 54014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Teach the Go KRL puller to name its zone, so a host whose FQDN also exists in another zone can still pull its own encrypted KRL.

TASK-226 makes POST /api/v1/external/ssh/krl return 409 AMBIGUOUS_HOST when the FQDN in the body matches hosts in more than one zone. Without a client-side way to disambiguate, such a host can never pull again.

krl-client/internal/config/config.go resolves configuration from four layered sources with the precedence `flag > env KRL_CLIENT_* > config file > built-in default`, and the env key is derived by upper-snake-casing the flag name (--server-url -> KRL_CLIENT_SERVER_URL). Add one field following that pattern exactly:

  Config.Zone      string   // zone slug sent in the POST /krl body; empty = let the server resolve
  flag             --zone
  env              KRL_CLIENT_ZONE
  config file key  zone
  default          "" (empty -- no behaviour change for every existing single-zone host)

The client sends it in the request body next to host_id only when non-empty, so an old server that does not know the field is unaffected (the route's body schema is additionalProperties: true).

Also worth handling explicitly: a 409 response today falls into the generic non-2xx path. AMBIGUOUS_HOST is an operator-configuration error, not a transient one, so it must NOT be retried and must produce a log line that tells the operator to set --zone, naming the candidate zones the server returned.

Do not change the decryption model, the trust anchor, the anti-rollback comparison or any on-host path default -- decisions 015 and 016 are untouched here. Note the standing rule in config.go: the on-host path defaults MUST stay byte-identical to backend/src/services/ssh-config.ts, and a defaults test asserts the exact strings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A host can be told which zone it belongs to via a flag, an environment variable or the config file, following the client's existing precedence rules
- [x] #2 A host that does not set a zone behaves exactly as before, so no deployed client needs changing
- [x] #3 A host whose FQDN exists in several zones pulls its own KRL successfully once its zone is set
- [x] #4 An ambiguity error is reported as an actionable configuration problem and is not retried as if it were transient
- [x] #5 The client's on-host path defaults and trust-anchor behaviour are unchanged and the existing defaults test still passes
- [x] #6 The README documents the new option and how to diagnose the ambiguity error
<!-- AC:END -->













## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. config.go: add the Zone field, its flag registration, env lookup and config-file key, following the existing pattern for a plain string option; extend the config-precedence test that already covers flag > env > file > default with a case for zone.
2. The HTTP client: include "zone" in the JSON body only when Config.Zone != "".
3. Error handling: recognise a 409 whose error code is AMBIGUOUS_HOST, treat it as non-retryable, and emit an actionable log/exit path (reuse the existing exitcodes vocabulary rather than inventing a new code unless none fits -- document the choice).
4. Update krl-client/README.md: the new flag/env/config key, when it is needed, and the 409 diagnosis.
5. Update the generated sshd drop-in / documented client invocation if either pins a full command line (check backend/src/services/ssh-config.ts and docs/ssh/*).
6. `make test` (and `make build`) in krl-client/; verify against a two-zone dev backend that a colliding FQDN fails without --zone and succeeds with it.
<!-- SECTION:PLAN:END -->

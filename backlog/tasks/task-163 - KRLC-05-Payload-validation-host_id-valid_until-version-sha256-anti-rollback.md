---
id: TASK-163
title: >-
  KRLC-05: Payload validation - host_id / valid_until / version + sha256 +
  anti-rollback
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 14:40'
labels:
  - ssh-cert-manager
  - automation
  - revocation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-162
priority: high
ordinal: 5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/payload: JSON-parse the decrypted plaintext into {krl, ca_signature, krl_version, valid_until, host_id}; base64-decode krl (-> bare KRL bytes) and ca_signature (-> DER, or null). Validate: host_id == --host-id; valid_until (Unix SECONDS) not past beyond --clock-skew; krl_version == the X-KRL-Version response header AND 'sha256:'+hex(sha256(krlBytes)) == krl_version; and the version/krl_number strictly newer than the installed one recorded in state (anti-rollback/replay). Map each failure to its exit code (6 host-mismatch, 5 expired, 8 version/integrity).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A payload whose host_id != --host-id exits 6; whose valid_until is past beyond --clock-skew exits 5; whose krl_version != X-KRL-Version OR whose sha256(krl) != the advertised version exits 8
- [x] #2 A payload whose krl_version/krl_number is not strictly newer than the state-recorded installed version is refused (exit 8, anti-rollback), while a strictly-newer one passes
- [x] #3 valid_until is interpreted as Unix SECONDS (a value near now+1800 validates today; a milliseconds-scale value does not spuriously pass)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
internal/payload: Parse (JSON + base64 of krl/ca_signature) then Validate — host_id!=--host-id ->6, valid_until past beyond --clock-skew (Unix seconds) ->5, krl_version!=X-KRL-Version OR !=sha256:hex(sha256(krl)) ->8, krl_number<=installed ->8 (anti-rollback). Confirmed backend krlVersion = 'sha256:'+hex(sha256(krlBlob)) so the integrity check matches exactly. Backend /krl payload now carries krl_number (integer, monotonic per-CA). --clock-skew flag added (300s). Validate takes now/skew for deterministic tests. 9 tests. Committed on feat/krl-client.
<!-- SECTION:NOTES:END -->

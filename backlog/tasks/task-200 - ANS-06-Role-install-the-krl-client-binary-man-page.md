---
id: TASK-200
title: 'ANS-06: Role: install the krl-client binary + man page'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 10:29'
labels:
  - ansible
  - ansible-integration
  - krl-client
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 27014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The role installs no puller binary. Add tasks to place a krl-client executable at /usr/local/bin/krl-client (0755) and its man page at /usr/local/share/man/man8/krl-client.8, sourced from a configurable release artifact URL/path (built via krl-client 'make build-static' or the CI artifact) with a checksum/version guard. Binary-only; config + scheduler are ANS-07.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After the role runs, /usr/local/bin/krl-client is present, executable (0755), and 'krl-client --version' (or --help) succeeds inside the container
- [x] #2 The install source (URL or local path) and expected version/checksum are role variables
- [x] #3 Re-running the role with the same version reports no change (idempotent, checksum-gated)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
krl_client.yml get_url installs /usr/local/bin/krl-client (0755) + man page; source URL/path + checksum are role vars; e2e ran the binary (executable) and re-run is checksum-idempotent.
<!-- SECTION:NOTES:END -->

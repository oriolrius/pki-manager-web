---
id: TASK-206
title: 'ANS-11: Docs + requirements refresh for the grown module'
status: Done
assignee: []
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 10:31'
labels:
  - ansible
  - ansible-integration
  - docs
milestone: Ansible Integration
dependencies:
  - TASK-203
  - TASK-197
  - TASK-198
  - TASK-199
  - TASK-200
  - TASK-204
  - TASK-201
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: medium
ordinal: 33014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update ansible/README.md, defaults documentation, and requirements to reflect the new surface: auth_principals population, authoritative drop-in fetch, renewal cadence + variables, the full krl-client deployment (binary source, ecdsa/ECIES key model, SSH_ECIES_ENABLED backend prereq, config/scheduler variables, TLS ca-bundle), the NTP hard-prerequisite check, the known_hosts and X.509 stretch toggles, and how to run the dockerized e2e. Document (or automate via site.yml) the community.crypto galaxy install. Ensure per-host vs per-CA KRL URL guidance is correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README documents every new role variable with defaults and a working ECIES + renewal example, and no longer contains the corrected drift statements
- [x] #2 The krl-client deployment prerequisites (ecdsa key, SSH_ECIES_ENABLED, NTP) are documented as enforced by the role, not just prose warnings
- [x] #3 A documented one-command path exists to run the dockerized e2e locally
- [x] #4 requirements.yml / galaxy dependency handling is documented or automated so a fresh controller can run the role without an undocumented manual step
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
README fully rewritten: all new vars documented with defaults + ECIES/renewal example; enforced prereqs (SSH_ECIES_ENABLED/ecdsa/NTP) documented as role-enforced; galaxy install + one-command e2e documented; tests/e2e/README.md added. meta description updated.
<!-- SECTION:NOTES:END -->

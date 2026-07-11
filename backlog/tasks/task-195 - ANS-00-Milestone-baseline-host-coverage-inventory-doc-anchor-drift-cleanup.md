---
id: TASK-195
title: 'ANS-00: Milestone baseline: host-coverage inventory doc-anchor + drift cleanup'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-11 09:32'
updated_date: '2026-07-11 09:38'
labels:
  - ansible
  - ansible-integration
  - docs
  - milestone
milestone: Ansible Integration
dependencies: []
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 22014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Open the milestone the way prior SSH milestones opened (BLK-00 pattern): produce a backlog milestone doc that inventories every host-deployable feature vs current ssh_host_cert coverage (the gap matrix), and fix the low-risk drift the audit already confirmed. Remove the dead ssh_ca_krl_url variable (defaults/main.yml:31, referenced by no task) and correct the misleading defaults/README claims that enabling ECIES 'installs the KRL puller' (defaults/main.yml:29-30, README.md:23-24) — it does not today. No functional host-behavior change; this task establishes the shared baseline and a truthful starting point.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A backlog milestone document exists listing each host-deployable feature with yes/partial/no coverage and the file:line evidence, and is referenced by every ANS-xx task
- [ ] #2 The unused ssh_ca_krl_url variable no longer appears in defaults, and grep for it across ansible/ returns only removed/history references
- [ ] #3 defaults/main.yml and README.md no longer claim ECIES enablement installs a puller; they accurately state registration-only until ANS-05/06/07 land
- [ ] #4 backlog task list shows the milestone with all ANS-xx tasks created and cross-linked
<!-- AC:END -->

---
id: TASK-165
title: 'KRLC-07: Atomic KRL install (0444 root:root) + version/state cache'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 14:43'
labels:
  - ssh-cert-manager
  - automation
  - revocation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-163
  - TASK-164
priority: high
ordinal: 7
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/installer and internal/state. Install: write the verified bare KRL bytes to a temp file in the SAME directory as --krl-file (0600), fsync, chmod 0444, chown 0:0 (root:root), os.Rename over --krl-file (atomic same-fs replace), fsync the parent dir. --dry-run does everything except the rename/state write. State (--state-dir, default /var/lib/krl-client): persist the installed krl_version (next If-None-Match), krl_number, installed-file sha256, and success timestamp - written atomically only after a successful install; read at startup for If-None-Match and anti-rollback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a successful run the target file is mode 0444 owner root:root, its bytes equal the decoded KRL, and it was created via temp-file+rename (a mid-write crash never leaves a partial or world-writable file)
- [ ] #2 --dry-run leaves --krl-file and state unchanged while logging the version it WOULD install; on the next real run the state-cached krl_version is sent verbatim as If-None-Match and a 304 causes no write
- [ ] #3 On a repeat 304 the installed file and state are untouched (idempotent no-op path)
<!-- AC:END -->

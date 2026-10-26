---
id: TASK-242
title: Export passwords and aliases cannot inject shell commands (JKS/keytool)
status: To Do
assignee: []
created_date: '2026-10-26 15:53'
labels:
  - backend
  - security
dependencies: []
priority: high
ordinal: 69014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-10-26 while reviewing TASK-237. JKS exports build keytool command strings with the export password (and alias / CA name) interpolated and run them through child_process.exec (/bin/sh -c): services/jks.service.ts (keystore + truststore, used by REST CA/certificate/bulk and tRPC single downloads) and the inline bulk JKS code in trpc/procedures/certificate.ts. Reproduced on an isolated backend: GET /api/v1/cas/:id/download?format=jks-truststore&password=x$(touch /tmp/rce237-proof)x created the file on the server. Any authenticated user (protectedProcedure / REST download) can run commands as the backend user; with OIDC off, anyone. The openssl PKCS#12/PKCS#8 helpers use execFile (no shell) but pass the password as pass:<pw> in argv, visible in the process list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Export passwords, aliases or certificate names containing shell metacharacters cannot execute commands on the server, on any JKS or PKCS#12 export path (REST CA/certificate/bulk, tRPC single/bulk)
- [ ] #2 keytool and openssl never receive export passwords on their command line (not visible in the process list)
- [ ] #3 Exports whose password or alias contains quotes, spaces, $ or backticks still produce keystores that open with exactly that password
- [ ] #4 Regression tests reproduce the injection attempt on every JKS export path and prove no command runs
<!-- AC:END -->

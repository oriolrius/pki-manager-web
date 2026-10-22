---
id: TASK-237
title: 'Keep export passwords out of URLs, logs and default-password fallbacks'
status: To Do
assignee: []
created_date: '2026-10-22 15:34'
updated_date: '2026-10-22 15:37'
labels:
  - backend
  - security
  - frontend
dependencies: []
priority: high
ordinal: 64014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from PR #14 review (2026-10-22). Export passwords for keystores/truststores (including CA private-key keystores) travel in URLs: the REST CA download (GET /api/v1/cas/:id/download?password=) and the tRPC certificate.download query (GET with JSON input in the URL). Fastify/pino logs the full URL on every incoming request (confirmed in dev), and reverse-proxy access logs capture it too. Because certificate.download is a query, React Query also caches its key (which contains the password) and the encrypted file until gcTime. The backend also still falls back to 'changeit' for JKS/P12 truststores and JKS keystores when the API is called without a password (jks.service.ts, ca.routes.ts p12-truststore, bulk JKS keystore/truststore in trpc/procedures/certificate.ts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CA and certificate exports accept the password without it appearing in any request URL (e.g. header or POST body), and the frontend uses that channel
- [ ] #2 Backend request logs never contain an export password, even for clients that still send it as a query parameter
- [ ] #3 Certificate exports from the UI do not keep the password or the exported file in the React Query cache
- [ ] #4 API calls for P12/JKS truststore or keystore exports without a password are rejected with 400 instead of using 'changeit', across single, CA and bulk downloads
- [ ] #5 Tests cover the new password transport, log redaction and missing-password rejection
- [ ] #6 The CA detail page never displays or copies an export password inside a download URL (Storage & Download URLs panel and Copy Link), while direct downloads still apply the displayed password
<!-- AC:END -->

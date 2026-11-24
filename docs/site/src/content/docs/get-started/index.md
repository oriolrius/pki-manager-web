---
title: What PKI Manager is
sidebar:
  order: 1
---

PKI Manager is a self-hosted web application to run your own certificate authorities:

- **X.509**: root and intermediate CAs, certificate issue, renew and revoke, CRLs.
- **SSH**: a User CA and a Host CA, principals, revocation lists (KRL) and per-host access blocks.
- **Kubernetes**: a cert-manager external issuer that signs cluster CSRs.

## Architecture

```
React SPA ──tRPC──┐                 OIDC provider (optional) ── bearer JWT
                  ▼
Backend (Fastify): /trpc · /api/v1 (REST + Swagger) · /api/v1/external (integration tokens)
   └ services → crypto · Cosmian KMS (private keys) · SQLite (metadata)
```

- Private keys live in a **Cosmian KMS** and never leave it. The database stores only KMS key ids and metadata.
- Login uses **OIDC** (Keycloak, Auth0, Okta, Azure AD and others). OIDC is optional: with no
  `OIDC_ISSUER` / `OIDC_AUDIENCE`, the backend runs without authentication — use that only for tests.

## Install

- **Production**: run the published Docker images with Docker Compose. Follow
  [Deployment](/pki-manager-web/operations/deployment/), then set up login with
  [OIDC](/pki-manager-web/operations/oidc/) or [Keycloak](/pki-manager-web/operations/keycloak/).
- **Development**: see [`DEVELOPMENT.md`](https://github.com/oriolrius/pki-manager-web/blob/main/DEVELOPMENT.md)
  in the repository.

## Where to go next

| You want to | Read |
|---|---|
| Build an internal CA and trust it on your machines | [Private root CA](/pki-manager-web/guides/private-root-ca/) |
| Issue certificates to Kubernetes workloads | [cert-manager issuer](/pki-manager-web/guides/k8s-issuer/) |
| Connect automation or SCEP devices | [Integrations](/pki-manager-web/guides/integrations/) |
| Replace `authorized_keys` and host fingerprints with SSH certificates | [SSH video series](/pki-manager-web/ssh/videos/) |
| Call the API | [API reference](/pki-manager-web/api/) |

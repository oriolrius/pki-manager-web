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

![Web UI and automation call the backend; the backend keeps private keys in Cosmian KMS and metadata in SQLite; login uses an optional OIDC provider](/pki-manager-web/diagrams/01-architecture.svg)

- Private keys live in a **Cosmian KMS** and never leave it. The database stores only KMS key ids and metadata.
- Login uses **OIDC** (Keycloak, Auth0, Okta, Azure AD and others). OIDC is optional: with no
  `OIDC_ISSUER` / `OIDC_AUDIENCE`, the backend runs without authentication — use that only for tests.

## Install

- **Production**: run the published Docker images with Docker Compose. Start with
  [Install and log in](/pki-manager-web/get-started/install/) and
  [Deployment](/pki-manager-web/operations/deployment/), then set up login with
  [OIDC](/pki-manager-web/operations/oidc/) or [Keycloak](/pki-manager-web/operations/keycloak/).
- **Development**: see [`DEVELOPMENT.md`](https://github.com/oriolrius/pki-manager-web/blob/main/DEVELOPMENT.md)
  in the repository.

## Where to go next

| You want to | Read |
|---|---|
| Install it and log in | [Install and log in](/pki-manager-web/get-started/install/) |
| Build an internal CA and issue, renew and revoke certificates | [Private CA and certificates](/pki-manager-web/guides/private-ca/) |
| Trust your root CA on browsers and devices | [Trust your root CA](/pki-manager-web/guides/private-root-ca/) |
| Issue certificates to Kubernetes workloads | [Kubernetes with cert-manager](/pki-manager-web/guides/kubernetes/) |
| Connect automation or SCEP devices | [Automation, tokens and SCEP](/pki-manager-web/guides/automation/) |
| Replace `authorized_keys` and host fingerprints with SSH certificates | [SSH video series](/pki-manager-web/ssh/videos/) |
| Call the API | [API reference](/pki-manager-web/api/) |

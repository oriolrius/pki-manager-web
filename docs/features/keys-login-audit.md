---
title: Keys, login and audit
summary: Private keys live in a KMS, people log in with your identity provider, and each change is written to an audit log.
group: platform
order: 8
links:
  - label: How it works, with the table of where each key lives
    href: ../how-it-works.md
  - label: OIDC login
    href: ../operations/oidc.md
  - label: Keycloak setup
    href: ../operations/keycloak.md
  - label: Security advisories of the project
    href: https://github.com/oriolrius/pki-manager-web/security/advisories
---

## What you can do

- Keep every private key that PKI Manager makes in Cosmian KMS. The database has certificates and
  key ids, not keys.
- Let people log in with your identity provider through OIDC. The setup is tested with Keycloak.
- Reserve the sensitive actions of the web UI for the `admin` role: create, revoke and delete a
  CA, revoke and delete a certificate, manage integrations, and manage the SSH CAs, zones and
  fleet tokens.
- Read the audit log through the API. Each row has the time, the operation, the object, the result,
  the IP address and who did it: a person, an integration or an SSH token.

## How it works

The browser logs in with the authorization code flow and PKCE. There is no client secret in the
browser. The backend checks each access token against the public keys of the identity provider.

The key of a CA signs certificates inside the KMS. It leaves the KMS in two cases only: to sign a
revocation list, in memory, and when an admin exports the CA as a keystore on a server that
allows it (`ALLOW_CA_KEY_EXPORT=true`, off by default). [How it works](../how-it-works.md) has the
full table.

A password for an exported file is never part of the address (URL), so it does not stay in
browser history or in server logs.

## What it does not do

- It has no users and passwords of its own. Without an OIDC provider there is no login at all,
  which is for a test on your own machine only.
- It does not use a hardware security module (HSM). Keys are in Cosmian KMS.
- The web UI has no page for the audit log. Read it through the API.
- It runs as one instance with one SQLite database. There is no cluster mode.
- It has no telemetry and no analytics.

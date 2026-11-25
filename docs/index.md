---
title: Run your own certificate authorities
summary: PKI Manager is a self-hosted web application for X.509 and SSH certificates. You create a certificate authority, issue and revoke certificates in a browser, and let Kubernetes, devices and scripts request certificates by themselves. Private keys are made and kept in a key management system.
image: features/img/dashboard.png
imageAlt: Dashboard of PKI Manager with counters for CAs, certificates and SSH, and a table of the certificates that expire next
---

## What it is for

A public certificate authority cannot sign a name that exists only inside your network, and it
does not sign your SSH logins. PKI Manager is for those cases:

- **Internal HTTPS.** Give `portal.acme.example` a certificate that your browsers accept, because
  they trust your own root CA.
- **Clients that prove who they are.** Give each device or service a client certificate, and take
  it away again with a revocation list that the server checks.
- **SSH logins without copied keys.** Sign SSH certificates for people and for servers. Nobody adds
  public keys to `authorized_keys` files, and nobody answers "yes" to an unknown host fingerprint.
- **Certificates that renew by themselves.** cert-manager in Kubernetes, devices that speak SCEP and
  your own scripts request certificates with a token.

You can do all of this with `openssl` and shell scripts. PKI Manager replaces the scripts with one
place that knows what was issued, for whom, when it expires, and who revoked it.

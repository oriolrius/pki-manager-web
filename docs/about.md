---
title: About this project
summary: PKI Manager is a personal project. I built it for my own infrastructure and I use it there. No company is behind it, and nothing is for sale.
facts:
  - label: Made by
    value: Oriol Rius, one person
  - label: Made for
    value: My own infrastructure
  - label: For sale
    value: Nothing
  - label: Support
    value: Best effort, no contract
  - label: Licence
    value: Apache-2.0
---

I am [Oriol Rius](https://oriolrius.cat). I needed certificates for my own servers, devices and SSH logins, and I did not
want to keep a folder of `openssl` scripts. So I built PKI Manager, and I use it for my own
infrastructure.

I publish the source code because it can be useful to someone else. That is the only reason.

## No commercial interest

- No company owns PKI Manager or sells it.
- There is no paid edition, no hosted service and no support contract.
- There is no advertising and no tracking. The application has no telemetry and no analytics, and
  this website has none.
- I do not ask for anything in return. Use it, change it, or ignore it.

## What you can expect

- **It does what I need.** A feature arrives when I need it, or when someone sends a pull request
  that fits the project.
- **Problem reports are welcome**, in [GitHub Issues](https://github.com/oriolrius/pki-manager-web/issues).
  I read them and I answer when I can. There is no response time.
- **A security vulnerability is reported in private**, not in an issue. The
  [security policy](../SECURITY.md) says how, what to include and what happens next.
- **Each release has notes.** Versions follow semantic versioning. Read the
  [release notes](../CHANGELOG.md) before an upgrade.
- **The software comes without warranty.** The licence is
  [Apache-2.0](https://github.com/oriolrius/pki-manager-web/blob/main/LICENSE): you can use, change
  and redistribute it. You are responsible for the certificate authority that you run with it.

## What it is built on

PKI Manager uses an OIDC provider such as [Keycloak](https://www.keycloak.org) for login, and its
Kubernetes issuer works with [cert-manager](https://cert-manager.io). These are separate projects
with their own licences. PKI Manager is not affiliated with them.

### The key store: my fork of OpenBao, not the standard OpenBao

PKI Manager does **not** run the standard OpenBao release. It runs a fork that I maintain:
[`oriolrius/openbao`, branch `pki-manager`](https://github.com/oriolrius/openbao/tree/pki-manager),
based on OpenBao v2.7.3. The published image is `ghcr.io/oriolrius/openbao` (signed, with a
`-pki-manager.N` version suffix).

The fork exists because standard OpenBao does not cover everything that PKI Manager used from
Cosmian KMS. The work is split in two:

| What PKI Manager needs | Where it is now |
|---|---|
| Make RSA and ECDSA keys, keep them, refuse to export the keys that must stay inside, sign | Standard OpenBao Transit (no change) |
| Build X.509 certificates and CRLs (Cosmian did this with its `Certify` operation) | PKI Manager itself: it builds each certificate and CRL, and Transit only signs it |
| Keep the certificates | The PKI Manager database |
| Unwrap the SCEP session key with the RA key (RSA PKCS#1 v1.5). Standard Transit decrypts RSA with OAEP only | **Added in the fork**: an opt-in Transit operation `session-key/pkcs1v15`, for one `rsa-3072` key, that never shows whether the padding was valid ([design and tests](https://github.com/oriolrius/openbao/blob/pki-manager/downstream/pki-manager/pkcs1v15-session-key.md)) |
| A container image built and signed from that source | **Added in the fork**: a reproducible image and its release workflow |

With the fork, PKI Manager 4 covers every function that it used from Cosmian KMS, and it does not
use Cosmian for anything. The rest of OpenBao is unchanged. I plan to propose the session-key
operation to the OpenBao project; until it is accepted there, PKI Manager needs the fork.

Licence of the fork: OpenBao is MPL-2.0, and its files keep that licence, also where the fork
changes them. The files that the fork adds are Apache-2.0, the licence of PKI Manager. The rules are
in [DOWNSTREAM-LICENSING.md](https://github.com/oriolrius/openbao/blob/pki-manager/DOWNSTREAM-LICENSING.md).

### Why PKI Manager no longer uses Cosmian KMS

Versions before 4 kept the keys in [Cosmian KMS](https://github.com/Cosmian/kms). It is a good,
complete product, and it did its job well here. The reason to leave it is its licence, not its
quality.

Cosmian KMS 4.11.3 and later is published under the Business Source License 1.1 (BUSL-1.1). That
is a source-available licence, not an open-source one: production use is free only up to 2 vCPU
(or 1 physical core), and not to offer it to third parties; each release becomes MPL-2.0 four
years after it is published. PKI Manager is Apache-2.0, and I want everyone who runs it to have the
same freedom for the whole stack: use it on any machine, for any purpose, without a licence
calculation. A key store under BUSL does not fit that, so version 4 replaced it with OpenBao, which
is open source (MPL-2.0) under the Linux Foundation. The full analysis is in
[decision-018](../backlog/decisions/decision-018%20-%20Replace-Cosmian-KMS-with-a-KeyStore-abstraction-backed-by-OpenBao-Transit.md).

## About me

- [oriolrius.cat](https://oriolrius.cat): my personal website.
- [oriolrius.blog](https://oriolrius.blog): my blog. I write there about the things I build and use.
- [oriolrius.me](https://oriolrius.me): my professional website. My professional work is separate
  from PKI Manager: this project is not a product or a service of it.

## How it is developed

Everything is public in the [repository](https://github.com/oriolrius/pki-manager-web): the code,
the tasks, and the reasons for the design.

- [Decision records](../backlog/decisions) explain why it is built the way it is.
- [Development setup](development/setup.md) shows how to run it from source.
- [How the docs are organised](development/documentation.md) explains where every document lives.

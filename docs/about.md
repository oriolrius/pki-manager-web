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

I am Oriol Rius. I needed certificates for my own servers, devices and SSH logins, and I did not
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
- **Each release has notes.** Versions follow semantic versioning. Read the
  [release notes](../CHANGELOG.md) before an upgrade.
- **The software comes without warranty.** The licence is
  [Apache-2.0](https://github.com/oriolrius/pki-manager-web/blob/main/LICENSE): you can use, change
  and redistribute it. You are responsible for the certificate authority that you run with it.

## What it is built on

PKI Manager keeps private keys in [Cosmian KMS](https://github.com/Cosmian/kms). It uses an OIDC
provider such as [Keycloak](https://www.keycloak.org) for login, and its Kubernetes issuer works
with [cert-manager](https://cert-manager.io). These are separate projects with their own licences.
PKI Manager is not affiliated with them.

## How it is developed

Everything is public in the [repository](https://github.com/oriolrius/pki-manager-web): the code,
the tasks, and the reasons for the design.

- [Decision records](../backlog/decisions) explain why it is built the way it is.
- [Development setup](development/setup.md) shows how to run it from source.
- [How the docs are organised](development/documentation.md) explains where every document lives.

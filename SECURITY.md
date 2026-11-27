# Security policy

PKI Manager is a personal project of one maintainer. There is no security team and no support
contract. This page says what you can expect when you report a vulnerability.

## Supported versions

Only the latest release gets security fixes. A fix comes in a new release; older releases get no
backport.

| Version | Security fixes |
|---|---|
| The latest release (see [Releases](https://github.com/oriolrius/pki-manager-web/releases)) | Yes |
| Any older release | No: upgrade to the latest release |

## Report a vulnerability

Do **not** open a public issue, a discussion or a pull request for a vulnerability.

Report it in private with GitHub private vulnerability reporting:
<https://github.com/oriolrius/pki-manager-web/security/advisories/new>

Only the maintainer and you can read the report. If you cannot use GitHub, the contact data on
<https://oriolrius.me> reaches the maintainer: ask for a private channel and do not put the
details in the first message.

### What to include

- The component: backend API, web UI, Kubernetes issuer, SCEP gateway, `krl-client`, a container
  image, or a workflow of this repository.
- The version or the commit, and how it is deployed (Docker Compose, Kubernetes, from source;
  with or without OIDC).
- The steps to reproduce it, or a proof of concept. Requests, responses and log lines help.
- The effect: what an attacker gets (for example a certificate that must not be issued, a
  read of data without permission, a way around a revocation).
- Any limit that you know: the role or the token that the attacker needs, the network position.
- If you want your name in the advisory.

Do not send private keys, real tokens or data of other people. Test only on an installation
that you own.

## What happens next

The times are a goal of one person in their free time, not a contract.

1. You get an answer in the advisory within 14 days. It says if the report is accepted, or what
   is missing.
2. The fix is prepared in a private fork of the advisory. A critical problem (for example: a
   certificate issued without permission, or a way around the login) goes before all other work.
   The goal is a release within 90 days of the report.
3. The fix is published as a new release, and the advisory is published with it. It names the
   affected versions and the fixed version, and it credits you if you want that.
4. If no fix is possible within 90 days, the maintainer tells you why and agrees a date with you
   before any detail is public.

Please keep the details private until the advisory is published.

## Scope

In scope: the code and the published artifacts of this repository.

- The backend, the web UI, the Kubernetes issuer, the SCEP gateway and `krl-client`.
- The container images `ghcr.io/oriolrius/pki-manager-web/*` and
  `ghcr.io/oriolrius/pki-manager-issuer`, and the release binaries.
- The Compose files and the Helm chart, when their defaults make an installation unsafe.
- The GitHub Actions workflows of this repository.
- The downstream patches of the PKI Manager build of OpenBao (the `pki-manager` branch of
  [oriolrius/openbao](https://github.com/oriolrius/openbao/tree/pki-manager)), and the OpenBao
  policies and configuration in this repository.

Out of scope:

- Vulnerabilities of other projects (upstream OpenBao, Keycloak, cert-manager, nginx, Node.js, Go).
  Report them to those projects. Tell the maintainer here when PKI Manager must change the
  version that it ships or how it uses them.
- The development and demo stacks (`just dev`, `just demo`): they use known passwords on
  purpose and must not be reachable from a network that you do not trust.
- An installation without OIDC. The management API then has no login, and this is documented:
  see [Run without login](docs/operations/oidc.md#run-without-login).
- Reports made only by an automatic scanner, with no way to use the finding.
- The related repositories ([pki-manager-cli](https://github.com/oriolrius/pki-manager-cli),
  [pki-manager-ansible](https://github.com/oriolrius/pki-manager-ansible)): report in the
  repository that has the code.

## Published advisories

<https://github.com/oriolrius/pki-manager-web/security/advisories>

## How the project lowers the risk

[CI and releases](docs/development/ci.md#supply-chain) describes the automatic checks: secret
scan, static analysis (CodeQL), image scan (Trivy), dependency review, Dependabot updates,
pinned actions and base images, signed release artifacts with build provenance.

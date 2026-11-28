---
id: decision-019
title: 019 - Maintain the OpenBao fork as a downstream distribution
date: '2026-11-28T07:39:00Z'
status: Accepted
---
## Context

[decision-018](../decisions/decision-018%20-%20Replace-Cosmian-KMS-with-a-KeyStore-abstraction-backed-by-OpenBao-Transit.md)
moved every private key of PKI Manager from Cosmian KMS to OpenBao Transit. Upstream OpenBao
2.7.3 cannot unwrap the RSA PKCS#1 v1.5 key transport of SCEP, so PKI Manager runs a fork:
[`oriolrius/openbao`](https://github.com/oriolrius/openbao), branch `pki-manager`, image
`ghcr.io/oriolrius/openbao:2.7.3-pki-manager.2`. PKI Manager 4.0.0 and 4.1.0 run on it in
production since 2026-11-27.

decision-018 made the fork, but it did not say how to keep it in time. These facts set the
choice:

- The fork holds every CA key. Upstream security fixes must arrive fast.
- One person maintains it, with no support contract.
- OpenBao does not accept contributions written with generative AI. A feature goes upstream
  only when the author writes the proposal by hand, so it can stay downstream for a long time,
  or for ever.
- The author wants upstream releases in the fork, and wants to add more of his own features,
  also features from his other projects.
- The fork is useful without PKI Manager: the published image runs as a normal OpenBao 2.7.3
  server (checked on 2026-11-27).
- OpenBao is MPL-2.0. That licence applies per file: changed OpenBao files stay MPL-2.0, new
  files can be Apache-2.0, the licence of PKI Manager.
- At v2.7.3-pki-manager.2 the difference from upstream v2.7.3 only adds lines (no upstream line
  is removed), so merges have little to conflict on.

### Alternatives considered

| Option | Result |
|---|---|
| **Hard fork**: own line, never merge upstream again | Rejected. Each upstream security fix needs a manual port, and the code moves away from upstream each month. One person cannot keep a key store safe like that |
| **Upstream only**: wait until OpenBao accepts the SCEP operation | Rejected as the plan. PKI Manager needs the operation now, and acceptance is not sure. It stays a goal for each feature that fits upstream |
| **Patch files outside a fork** (a patch queue applied at build time) | Rejected. GitHub sync, pull requests and the upstream test suite work on a fork branch, not on loose patches |
| **New product name** | Rejected. The name stays "OpenBao, PKI Manager build", which says what it is. The docs state that it is not an official release and not affiliated with the OpenBao project |
| **Leave the GitHub fork network** | Rejected. It removes "Sync fork" and the visible link to the source project |
| **Downstream distribution** | **Chosen** |

## Decision

The fork is a **downstream distribution** of OpenBao: it follows each upstream release, and
keeps its own features on top.

1. **Repository.** One GitHub fork, `oriolrius/openbao`:
   - `main` is a copy of upstream `main`. No commits of ours go there.
   - `pki-manager` is the distribution and the default branch. Images are built only from it.
2. **Versions.** Tag `v<upstream>-pki-manager.<n>`; `<n>` counts the downstream releases on
   one upstream version. The tag builds, signs and publishes the image, and has release notes.
3. **Upstream releases.**
   - Each Monday, the workflow `pki-manager-upstream.yml` finds the latest upstream release.
   - When `pki-manager` does not have it, the workflow tries the merge without pushing and
     opens an issue with the result.
   - The maintainer runs `downstream/scripts/sync-upstream.sh <tag>` with his own GitHub
     account. The script merges the tag into `sync/<tag>`, sets the version and opens the pull
     request.
   - The pull request runs the upstream and the downstream tests. When they pass, it is merged
     and tagged `v<tag>-pki-manager.1`.
   - Not in CI, because a workflow token cannot push upstream workflow files, and its pull
     requests do not start the checks.
4. **Features.** Each downstream feature has:
   - an id, a specification and tests in `downstream/`;
   - a status: **downstream only** or **upstream candidate**.

   The registry is the "Features" table of `downstream/README.md`. Today:
   - D1: Transit `session-key/pkcs1v15`, a core patch and an upstream candidate.
   - D2: the reproducible, signed image, downstream only.
5. **Where a feature goes.**
   - An **external plugin**, with its own repository and version, put into the image at build
     time, when it does not need OpenBao internals.
   - A **core patch** only when it must read internal state (D1 reads the Transit key
     material).
   - Core patches add files where possible and change few upstream lines.
   - Code from another project comes in only with a licence that fits MPL-2.0 and Apache-2.0.
     No BUSL code.
6. **Licence.** Upstream files keep MPL-2.0, also where we change them. New files are
   Apache-2.0 with an SPDX header (`DOWNSTREAM-LICENSING.md`).
7. **Upstream proposals.** A feature marked "upstream candidate" is proposed to OpenBao only
   by hand, without AI, by the author. Each accepted feature leaves the downstream code.

## Consequences

- Upstream security fixes reach PKI Manager with one merge, one tag and one image pin in
  `openbao/image.env`. The Monday issue shows when one is waiting.
- Each upstream release costs a merge and a full test run. A conflict, or a new Go version,
  needs a person. The script stops and says what to do.
- Keeping the diff small is a rule for every new feature. A large core change makes each
  later merge more expensive.
- Plugins add their own releases and builds, but they never conflict with upstream merges.
- PKI Manager pins one image digest. A fork release changes nothing in PKI Manager until the
  pin moves.
- The fork is also a tool of its own: people can run it without PKI Manager. It has no
  support contract, and the docs say so.
- The weekly watch and the sync script are new. The first real upstream release will be the
  first full test of them; until then only the "nothing to merge" path ran.

## Sources

- Fork specification: <https://github.com/oriolrius/openbao/blob/pki-manager/downstream/README.md>
- Releases: <https://github.com/oriolrius/openbao/releases>
- Fork pull requests: [#1](https://github.com/oriolrius/openbao/pull/1) (the specification),
  [#2](https://github.com/oriolrius/openbao/pull/2) (the upstream watch, the script and the
  feature registry)
- OpenBao contributing guide (the rule on generative AI):
  <https://github.com/openbao/openbao/blob/main/CONTRIBUTING.md>

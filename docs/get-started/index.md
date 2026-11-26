# Start here

PKI Manager is a self-hosted web application to run your own certificate authorities for X.509,
SSH and Kubernetes. Private keys stay in OpenBao Transit.

New here? Read these first. They need no install:

- [What it does](../features/): each capability, with screenshots.
- [How it works](../how-it-works.md): the parts, and where the private keys live.
- [About this project](../about.md): who makes it and what to expect.

## Install

- **To use it**: [Install PKI Manager and log in](install.md) runs the published images with
  Docker Compose in about ten minutes. Then read [Docker deployment](../operations/deployment.md)
  for production, and [OIDC login](../operations/oidc.md) or
  [Keycloak setup](../operations/keycloak.md) for login.
- **To develop it**: [Development setup](../development/setup.md).

## Where to go next

| You want to | Read |
|---|---|
| Install it and log in | [Install and log in](install.md) |
| Build an internal CA and issue, renew and revoke certificates | [Private CA and certificates](../guides/private-ca.md) |
| Let only devices with a valid certificate connect, and revoke them (Mosquitto example) | [Client certificate authentication with revocation](../guides/mqtt.md) |
| Trust your root CA on browsers and devices | [Trust your root CA](../guides/private-root-ca.md) |
| Issue certificates to Kubernetes workloads | [Kubernetes with cert-manager](../guides/kubernetes.md) |
| Connect automation or SCEP devices | [Automation, tokens and SCEP](../guides/automation.md) |
| Replace `authorized_keys` and host fingerprints with SSH certificates | [SSH video series](../ssh/explainer/index.html) |
| Call the API | [REST API](../api/index.md) |
| Upgrade | [Release notes](../../CHANGELOG.md) |

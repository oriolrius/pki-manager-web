---
title: How it works
summary: The parts of PKI Manager, where each private key lives, and what happens when you issue or revoke a certificate.
---

## The parts

![The web UI and automation call the backend. The backend keeps private keys in OpenBao Transit and metadata in SQLite. Login uses an optional OIDC provider](diagrams/svg/01-architecture.svg)

| Part | What it does |
|---|---|
| Web UI | The pages that you use in the browser. An nginx container serves them and passes API calls to the backend |
| Backend | The API and all certificate logic. It checks each request, builds the certificates and has OpenBao sign them, signs the revocation lists, and writes the audit log |
| OpenBao | The PKI Manager build of OpenBao. Its Transit secrets engine makes and keeps the private keys, and signs with them. It keeps the X.509 keys, the SSH CA keys and the SCEP RA keys |
| Database | One SQLite file: CAs, certificates, the references of the keys in OpenBao, SSH data and the audit log. It has no private keys |
| Identity provider | Optional. Logs people in through OIDC, for example Keycloak |

Three optional parts run outside this core. The [SCEP gateway](features/device-enrollment.md) is one
more container. The [Kubernetes issuer](features/kubernetes.md) runs in your cluster. `krl-client`
runs on SSH servers and fetches their revocation list.

## Where each private key lives

| Key | Where it is made | When it leaves OpenBao |
|---|---|---|
| Key of a certificate authority (CA) | In OpenBao Transit | An admin can export a password-protected keystore if the CA key was created exportable and the server has `ALLOW_CA_KEY_EXPORT=true`. Each export is audited. Transit signs certificates and CRLs. |
| Key of a certificate that you issue in the web UI or the API | In OpenBao Transit, as an exportable key | When someone downloads a file that contains the key (PEM key, PKCS#12, Java keystore) |
| Key of a certificate that is requested with a CSR (Kubernetes, SCEP, your scripts) | By the requester | It is never in PKI Manager. PKI Manager sees only the CSR |
| Key of an SSH CA | In OpenBao Transit, and it cannot be exported | Never. OpenBao signs each SSH certificate and each KRL |
| Key of the SCEP registration authority | In OpenBao Transit, and it cannot be exported | Never. OpenBao signs, and unwraps the session key of each SCEP request |
| Keys of SSH servers and of people | On the server, or on the machine of the person | PKI Manager gets the public key only |

## When you issue a certificate

1. You choose the CA, the type, the names and the validity.
2. The backend checks the request: the CA must be active and not expired, the names must be valid,
   and the validity must be 825 days or less.
3. OpenBao makes the key pair of the certificate.
4. The backend builds the certificate, and OpenBao signs it with the key of the CA. The key of the
   CA stays in OpenBao.
5. The backend stores the certificate and the reference of its key, and writes a row in the audit log.
6. You download the certificate in the format that you need.

With a certificate signing request (CSR), steps 3 and 6 are different: the requester already has
the key, and gets back only the signed certificate.

## When you revoke a certificate

1. You revoke it with a reason.
2. The backend marks it as revoked and publishes a new certificate revocation list (CRL) for that
   CA. It builds the list, and OpenBao Transit signs it with the key of the CA. When OpenBao cannot
   sign, the revocation stays and the backend publishes the CRL later. See
   [Revocation and CRLs](features/revocation.md#when-openbao-cannot-sign).
3. Clients and servers fetch the CRL from a public address and refuse the certificate.

SSH uses its own list, the KRL. See [SSH certificate authority](features/ssh-certificates.md).

## Login and permissions

People log in through your OIDC identity provider, in the browser, with the authorization code
flow and PKCE. The backend checks each access token against the public keys of the provider.

In the web UI, the sensitive actions need the `admin` role. Scripts and services do not log in
as people. An integration has its own token, bound to one CA, and SSH automation uses fleet
tokens. See [Keys, login and audit](features/keys-login-audit.md).

## What you run

The core is three containers: the web UI, the backend and OpenBao. OpenBao must be initialised and
unsealed before the backend can sign. The backend connects to it over HTTPS with a token that
can use only the Transit operations of PKI Manager.

All data is in two stores: the SQLite database, and the storage of OpenBao. A backup is a copy of
both, taken together: a database without its keys, or keys without the database, cannot be used.
See [Install PKI Manager and log in](get-started/install.md).

## What it does not have

- **More than one node.** It is one backend with one SQLite database and one OpenBao. There is no cluster mode.
- **Intermediate CAs.** Each CA is a self-signed root.
- **OCSP.** Revocation is by CRL for X.509 and by KRL for SSH.
- **ACME, EST or CMP.** Machines get certificates through the REST API, the cert-manager issuer or SCEP.
- **A hardware security module.** Transit keys are software keys in the storage of OpenBao, encrypted by the OpenBao seal.
- **Alerts.** The dashboard and the API show what expires next. Nothing is sent to you.
- **Other languages.** The web UI is in English.

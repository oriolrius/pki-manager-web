# Intune / MDM device certificates for EAP-TLS

The gateway implements the commercial-cloud Intune third-party SCEP protocol
contract. The intended deployment is **device** certificates for WLAN/VPN on
Windows, iOS/iPadOS, macOS and Android Enterprise. It provides a SCEP service, not
an MDM server, a RADIUS server, or a Microsoft-certified connector.

## What is implemented and what must be tested in your tenant

Implemented: full-CSR dynamic challenge validation, Microsoft Graph service
location discovery, client-credentials OAuth, success/failure notifications,
managed SANs, fresh-challenge renewal with active old-signer checks, and Intune
revocation polling with a durable pending-batch journal.

Tests cover the Microsoft SDK HTTP contract using mock services and full SCEP
issuance/renewal against the local PKI backend and Cosmian KMS. They do **not**
prove access to your tenant, correct consent, a working Intune policy assignment,
or successful enrollment on a physical device. Complete the acceptance steps
below on each operating system before calling the deployment production ready.

Protocol reference (MIT license retained in `../NOTICE.intune`):
[Microsoft Intune Resource Access SCEP SDK](https://github.com/microsoft/Intune-Resource-Access/tree/eae184eea8f7dab417d3ac29cc3ac39b7db8cace/src/CsrValidation).
See Microsoft's [third-party SCEP API documentation](https://learn.microsoft.com/en-us/intune/intune-service/protect/scep-libraries-apis)
for current app registration and permission requirements. The adapter uses the
SCEP service API version `2018-02-20` and the revocation API version `5019-05-05`
as published in that SDK. It does not use deprecated Azure AD Graph fallbacks.

## Tenant and service preparation

1. Register a confidential application in the target Microsoft Entra tenant.
   Grant and admin-consent the Intune **SCEP challenge provider** application
   permission and the Microsoft Graph application permission needed to read the
   Intune service principal's endpoints (typically `Application.Read.All`), following
   Microsoft's current documentation. Delegated user tokens and the application's
   display name alone are insufficient. The service discovers endpoints on the
   Intune service principal with app ID `0000000a-0000-0000-c000-000000000000`.
2. Record the tenant ID and application/client ID. Store a client secret in a
   protected file or secret manager. Do not commit it or paste it into a PR/chat.
3. Create a dedicated issuing CA and a CA-bound service token in PKI Manager.
   Provision the RA using the [base gateway instructions](../README.md). The RA
   key remains Sensitive in KMS; the existing CA is not exported to an NDES host.
4. Configure a public, trusted HTTPS SCEP URL such as
   `https://scep.example.com/scep`. Devices need network access to it without an
   interactive browser/OIDC login. Keep management and KMS endpoints private.
5. Permit outbound HTTPS from the gateway to `login.microsoftonline.com`,
   `graph.microsoft.com`, and the `*.manage.microsoft.com` service endpoints
   returned by Microsoft Graph. The application only accepts HTTPS discovery
   destinations within `manage.microsoft.com`, with no URL credentials or custom
   port. It never forwards a token to a third-party discovery URL.

No Intune tenant credentials are shipped with this repository. Government and
other sovereign clouds are not configured by replacing arbitrary URLs; they
require an explicitly implemented authority/resource/host policy.

## Docker configuration

Prepare the base secret files described in `../README.md`. In Intune mode,
`docker/scep-secrets/challenge` can be an empty file: Compose mounts it for the
base service, but **it is never used for enrollment authorization in Intune mode**.
Do not configure a fixed challenge in the Intune device profile.

Create `docker/scep-secrets/intune-client-secret` using a secure editor; give it
owner UID/GID 10001 and mode 0400, just like the other Compose secrets. Add these
non-secret values to your existing local `docker/.env` (merge, do not overwrite):

```dotenv
SCEP_AUTH_MODE=intune
SCEP_INTUNE_TENANT_ID=YOUR_TENANT_ID
SCEP_INTUNE_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
SCEP_VALIDITY_DAYS=90
SCEP_INTUNE_REVOCATION_POLL_SECONDS=60
```

Then run from `docker/`:

```sh
docker compose -f docker-compose.yml -f docker-compose.scep.yml -f docker-compose.intune.yml --profile scep build scep
# The Compose overlay provisions a missing RA automatically on first start.
docker compose -f docker-compose.yml -f docker-compose.scep.yml -f docker-compose.intune.yml --profile scep up -d scep
```

Startup requires successful Intune SCEP service discovery. With revocation polling
enabled, it also requires discovery of `PkiConnectorFEService`. Missing app
credentials/consent fail startup; requests never fall back to the shared password.
The standalone equivalent is in `../.env.intune.example`.

## Intune profiles

Create and assign the trusted-root profile **before** the SCEP and WLAN/VPN
profiles. Export the issuing/root public certificates from PKI Manager; do not
upload the CA private key or use a P12 keystore as the trust profile. For a chain,
make sure every client and RADIUS/VPN server has the required issuer trust.

Create a separate platform SCEP profile for each OS family. Configure the device
profile through the current Intune UI; do not assume one Graph JSON schema works
across all platforms.

| Setting | Intended value |
| --- | --- |
| Certificate type | Device, not User |
| SCEP URL | Public HTTPS `/scep` URL |
| Key type / size | RSA / 2048 bits (3072/4096 may be used where supported) |
| Hash | SHA-256 |
| EKU | Client Authentication, `1.3.6.1.5.5.7.3.2` |
| Key usage | Digital signature and key encipherment |
| Subject CN | A stable, unique device identity supported by that platform's Intune variables |
| SAN | Device DNS/URI identity required by your RADIUS/VPN mapping |
| Validity | Match `SCEP_VALIDITY_DAYS`; default 90 days |
| Renewal threshold | For example 20% remaining validity; test actual renewal on each platform |
| Trust/root profile | The CA profile assigned to the same pilot devices |

Use only variables documented for the target platform and enrollment type. For
example, `CN={{AAD_Device_ID}}` can be used where Intune makes that variable
available; do not assume unsupported variables are expanded. Device names can be
renamed/non-unique and should not silently become the sole authorization key for
network access. The adapter sends the **original CSR** to Intune and relies on
Intune to match subject, SAN, EKU, usage and public key against the signed dynamic
challenge. A modified SAN cannot be approved through a shared-password fallback.

| Platform | Deployment considerations |
| --- | --- |
| Windows | Use the device/machine certificate store. Prefer a TPM-backed RSA key with an explicitly chosen software fallback policy. Match the WLAN/VPN profile's machine authentication and RADIUS identity mapping. |
| iOS/iPadOS | Use the device SCEP identity in the WLAN/VPN payload, with the trusted root installed. Confirm profile assignment and identity selection on a pilot device. |
| macOS | Deploy in device context and verify the system identity is available to the selected WLAN/VPN payload and access controls. |
| Android Enterprise | Select the correct fully managed, dedicated, or corporate/work-profile policy type. Confirm that its key/identity scope is available to the WLAN/VPN policy. |

Linux and other device types without an Intune SCEP certificate profile need a
separate enrollment workflow; this gateway does not add missing Intune platform
capabilities. A generic SCEP client can instead use the documented shared or
webhook mode, subject to its client capabilities.

The managed profile supports DNS, IP, RFC822 email, URI (including Microsoft's SID
mapping `tag:` URIs) and Microsoft UPN `otherName` SANs. It rejects unknown SAN
types, CA:true, and non-client EKUs. Requesting a SID URI does not create or verify
an AD computer mapping by itself: configure Intune's supported identity variables
and RADIUS/domain strong certificate mapping according to Microsoft's current
requirements. Cloud-only devices are not automatically AD computer accounts.

## Renewal and revocation

The gateway advertises `Renewal`. In managed modes a `RenewalReq`/`UpdateReq` must contain a new,
valid MDM challenge. The previous signer certificate must be CA-signed, unexpired,
active and owned by the gateway's backend identity. New CSR keys are supported;
the response is encrypted to the old signer so only that device can retrieve it.
Shared-password mode requires its configured shared challenge instead of MDM
validation, with the same ownership/active checks. An expired/revoked old signer
requires fresh initial enrollment. Do not rotate the service identity by creating
a different integration and expect it to own old certificates. The device/MDM
must schedule renewal before expiry; the gateway does not push certificates.

Intune success notification must be accepted before a success CertRep is returned.
If notification fails after backend issuance, the certificate is retained but not
delivered; a device retry repeats validation and uses the backend's CSR idempotency
key, rather than blindly issuing a second certificate. Challenges that have
expired or are no longer targeted must be replaced by Intune. Failure notification
is sent when backend issuance fails after successful Intune validation.

By default the native Intune mode polls `PkiConnectorFEService` every 60 seconds.
Downloaded requests are saved in `/data/intune-revocations.json` before changing
certificates. The backend token can revoke only its own CA's certificates. CRL
publication is retried even when database revocation already succeeded. Pending
batches survive gateway restarts and are removed only after Intune acknowledges
the uploaded results. A foreign tenant/CA/service-token journal is rejected; drain pending batches before
changing the tenant, CA or service token. Protect and retain
the state volume. Set `SCEP_INTUNE_REVOCATION_STATE_FILE` to change its location.

Setting `SCEP_INTUNE_REVOCATION_POLL_SECONDS=0` explicitly disables automatic
revocation polling; that is not a complete managed revocation lifecycle. RADIUS
and VPN servers must actually consume the CA CRL/revocation information. Otherwise
a revoked certificate may still be accepted by the network service. Configure
reachable CRL distribution points and test their enforcement.

## Acceptance before rollout

Use a pilot group with one device from **each** target OS/enrollment type:

1. Confirm the trusted root and device SCEP profiles are assigned, the expected
   private key is generated on the device, and the device receives a CA-signed
   certificate with the expected CN/SAN, clientAuth EKU and validity.
2. Confirm Intune reports successful enrollment and the PKI audit log contains
   issuance for the gateway's CA-bound service identity.
3. Authenticate to the intended EAP-TLS WLAN/VPN and verify the RADIUS/VPN server
   trusts the chain and maps the expected device identity.
4. Verify renewal with a new dynamic challenge, including any key rotation policy.
   Verify a revoked old signer cannot renew.
5. Retire/revoke a pilot certificate through the configured Intune workflow.
   Confirm the gateway consumes the request, the backend marks it revoked, the
   CRL updates, Intune receives the result, and network authentication is denied.
6. Interrupt Intune validation/notification and restart the gateway with a pending
   revocation batch. Confirm fail-closed behavior and recovery without duplicate
   certificate issuance or lost revocation results.

Completing those steps requires tenant credentials and real devices. Unit tests
and a mocked Microsoft endpoint alone are not evidence of tenant readiness.

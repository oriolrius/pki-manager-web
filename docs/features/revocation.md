---
title: Revocation and CRLs
summary: Revoke a certificate and publish a signed revocation list that servers and clients can check.
group: x509
order: 3
image: img/certificate-revoked.png
imageAlt: Detail page of a revoked certificate with the date and the reason of the revocation
links:
  - label: "Guide: revoke a client and make the broker refuse it (Mosquitto)"
    href: ../guides/mqtt.md
  - label: "Guide: revoke, end to end"
    href: ../guides/private-ca.md
  - label: "Decision record: how the CRL is signed"
    href: "../../backlog/decisions/decision-010 - CRL-Signing-Approach-Export-CA-Key-vs-KMIP-Sign.md"
---

## What you can do

- Revoke a certificate with a standard reason, for example `keyCompromise`, `superseded` or
  `cessationOfOperation`, and an optional note.
- After each revocation, PKI Manager signs a new certificate revocation list (CRL) for that CA.
- Anyone can fetch the CRL without login: `/crl/<caId>.crl` (PEM) and `/crl/<caId>.der`.
- When the server has `CRL_DISTRIBUTION_URL`, each certificate carries the address of its CRL. A
  client that checks revocation finds the list by itself.
- A new CA has an empty CRL from the start.
- Revoke a CA. All its active certificates become revoked with the reason `caCompromise`, in one
  database transaction. Then PKI Manager signs a new CRL of that CA that lists them. The response
  field `crlGenerated` tells if the CRL was signed. When the KMS cannot sign at that moment, the
  CA stays revoked, and the next request for its CRL signs the list.

## How it works

The CRL lists the serial numbers of the revoked certificates of one CA, with the reason of each
one. It is valid for 7 days. When a client asks for a list that is past that date, the backend
signs a new one.

To sign a CRL, the backend takes the key of the CA out of the KMS, signs in memory and discards
the key. The decision record explains why.

Revocation works only when the server that accepts the certificate reads the CRL. The Mosquitto
guide shows the full path: revoke in PKI Manager, refresh the CRL file of the broker, and see the
broker refuse the client.

## What it does not do

- There is no OCSP responder. Revocation is by CRL.
- PKI Manager does not push the CRL to your servers. Each server fetches it, for example with a timer.
- SSH has its own revocation list (KRL). See [SSH certificate authority](ssh-certificates.md).

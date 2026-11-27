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
  - label: "Historical decision: CRL signing in version 3"
    href: "../../backlog/decisions/decision-010 - CRL-Signing-Approach-Export-CA-Key-vs-KMIP-Sign.md"
  - label: "Decision record: OpenBao Transit as the key store"
    href: "../../backlog/decisions/decision-018 - Replace-Cosmian-KMS-with-a-KeyStore-abstraction-backed-by-OpenBao-Transit.md"
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
  field `crlGenerated` tells if the CRL was signed. When OpenBao cannot sign at that moment, the
  CA stays revoked, and the next request for its CRL signs the list.
- Delete a revoked certificate. Its serial stays in the CRL. To take the serial out of the CRL,
  delete with `removeFromCrl=true`. Do not do this while the certificate is still valid: a client
  then accepts it again.

## How it works

The CRL lists the serial numbers of the revoked certificates of one CA, with the reason of each
one. It is valid for 7 days. When a client asks for a list that is past that date, the backend
signs a new one.

The backend builds the list and sends the data to OpenBao Transit for signing. A CA with a non-exportable key can issue CRLs.

### Numbers and entries

- The backend publishes one CRL at a time for each CA. This is also true for revocations at the
  same time and for several backend processes on one database.
- Each new CRL has a higher CRL number than all the CRLs of that CA before it.
- Each new CRL lists all the entries of the CRL before it, and all the revoked certificates of the
  CA. Only `removeFromCrl` takes an entry out.
- When a revocation does not change the list, no new CRL is made. A CRL generate request
  (`POST /api/v1/cas/<caId>/crls`) always makes a new one.
- Version 3 could give the same number to two different CRLs when revocations came at the same
  time. Those CRLs stay in the history as they are. The first new CRL has a number above the
  highest old one, and it lists the entries of all the old CRLs with that number.

### When OpenBao cannot sign

A revocation still succeeds when OpenBao is sealed or cannot be reached. The CRL stays as it was,
so it does not list the new revocation yet. The backend signs the missing CRL when OpenBao works
again:

- at the next request for the CRL (`/crl/<caId>.crl` or `.der`),
- every minute in the background, also after a restart of the backend,
- at the next revocation of that CA.

After a failure, the CRL requests and the background job wait before they try again: 5 seconds,
then double the time after each failure, at most 60 seconds. While the CRL does not list all the
revocations, its `Cache-Control` time is at most 30 seconds, so caches fetch it again soon.

Revocation works only when the server that accepts the certificate reads the CRL. The Mosquitto
guide shows the full path: revoke in PKI Manager, refresh the CRL file of the broker, and see the
broker refuse the client.

## What it does not do

- There is no OCSP responder. Revocation is by CRL.
- PKI Manager does not push the CRL to your servers. Each server fetches it, for example with a timer.
- SSH has its own revocation list (KRL). See [SSH certificate authority](ssh-certificates.md).

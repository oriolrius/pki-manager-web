---
title: Certificate authorities
summary: Create your own root certificate authorities. The key of each CA is made in OpenBao Transit, and OpenBao signs with it.
group: x509
order: 1
image: img/ca-detail.png
imageAlt: Detail page of a root CA with its validity, key algorithm, serial number and download URLs
links:
  - label: "Guide: build a private CA and issue certificates"
    href: ../guides/private-ca.md
  - label: "Guide: trust your root CA on browsers and devices"
    href: ../guides/private-root-ca.md
  - label: How it works
    href: ../how-it-works.md
---

## What you can do

- Create a self-signed root CA with your own subject (common name, organisation and country; unit,
  state and locality are optional), an RSA-2048 or RSA-4096 key, and a validity of 1 to 30 years.
- Keep several CAs side by side, for example one for servers and one for devices.
- Download the CA certificate as PEM, CRT, DER or CER, or as a PKCS#12 or Java truststore.
- Give clients a public address for the CA certificate: `/cas/<id>.pem` needs no login.

## How it works

The backend asks OpenBao Transit to create the key pair. Then the backend builds the self-signed
certificate and Transit signs it with the new key. The database stores the certificate and a
reference to the key: its name and its version in Transit.

The CA certificate has the extensions that make it a CA: `basicConstraints` with `CA:TRUE` and
`keyUsage` with certificate signing and CRL signing, both critical.

When you create a CA, PKI Manager also publishes a first, empty revocation list. The address of
the list works from the first day.

## What it does not do

- It makes root CAs only. There are no intermediate CAs.
- CA keys are RSA (2048 or 4096 bits). Certificates that the CA signs can use ECDSA keys.
- The CA key cannot be downloaded unless the server runs with `ALLOW_CA_KEY_EXPORT=true`. Then
  only an admin can do it, and each export is written to the audit log. The export also needs a
  CA key that was created as exportable in OpenBao: OpenBao refuses to export any other key.

---
title: Device enrollment (SCEP)
summary: An optional SCEP gateway lets managed phones, laptops and network devices enroll for a client certificate.
group: automation
order: 6
links:
  - label: "Guide: enroll a device with SCEP"
    href: ../guides/automation.md
  - label: SCEP gateway reference
    href: ../../scep/README.md
  - label: SCEP with Microsoft Intune
    href: ../../scep/docs/intune.md
---

## What you can do

- Run the SCEP gateway as one more container. Devices and device-management systems that speak
  SCEP ask it for a certificate.
- Choose who may enroll, in one of three ways:
  - a shared challenge password,
  - validation by Microsoft Intune,
  - validation by your own device-management system, through a webhook.
- Issue client-authentication certificates with a validity of up to 90 days.
- Let devices renew their certificate over SCEP.

## How it works

The gateway holds no keys and cannot reach the KMS. It talks to the backend with a token that is
bound to one CA.

SCEP needs a registration authority (RA) key to sign and decrypt the messages of the devices. That
key is made in the KMS, and the KMS does the signing and the decryption. The RA certificate is
renewed automatically before it expires.

Each request is checked: the key of the device, the name in the request, and the permission to
enroll. Then the backend signs the certificate with the key of the CA.

## What it does not do

- Devices must use RSA keys of 2048 to 8192 bits. ECDSA device keys are not accepted.
- With a shared challenge, the certificate has a common name only. Other names (DNS, email, IP)
  need validation by Intune or by the webhook.
- The Intune mode is implemented and has automated tests. It is not claimed as tested with a real
  Intune tenant and real devices.
- Run one gateway, not several copies.

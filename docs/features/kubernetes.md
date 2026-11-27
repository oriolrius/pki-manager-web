---
title: Kubernetes with cert-manager
summary: cert-manager asks PKI Manager for certificates. Your cluster gets certificates from your own CA and renews them without you.
group: automation
order: 5
image: img/integrations.png
imageAlt: Integrations page with a Kubernetes, a generic and a SCEP integration, each bound to one CA, with its token prefix, status and last use
links:
  - label: "Guide: issue Kubernetes certificates with cert-manager"
    href: ../guides/kubernetes.md
  - label: "Reference: how PKI Manager signs Kubernetes CSRs"
    href: ../guides/k8s-csr-signing.md
  - label: Integration API
    href: ../api/integrations.md
---

## What you can do

- Install the issuer in the cluster with its Helm chart, `pki-manager-issuer`.
- Create an `Issuer` (one namespace) or a `ClusterIssuer` (the whole cluster) that points to PKI Manager.
- Use normal cert-manager resources: a `Certificate`, or an annotation on an `Ingress`.
- Let cert-manager renew each certificate before it expires.
- Set `revokeOnDelete` when a deleted request must also revoke its certificate in PKI Manager.
- Read Prometheus metrics from the issuer: signing count, signing time, revocations and readiness.
- See the certificates of the cluster in PKI Manager, next to the others.

## How it works

![cert-manager creates a certificate request, the issuer sends the CSR to PKI Manager, and PKI Manager signs it with the CA key in OpenBao Transit](../diagrams/svg/12-k8s-issuer-flow.svg)

In PKI Manager you create an integration of type Kubernetes. It gives a token that works for one
CA only. The token goes into a Kubernetes Secret.

cert-manager makes the private key and the certificate signing request (CSR) inside the cluster.
The issuer sends the CSR to PKI Manager. PKI Manager checks it and signs it with the key of the CA.
The private key of the certificate never leaves the cluster.

A repeated request with the same id gets the same certificate, so a retry does not issue twice.

## What it does not do

- It is not an ACME server. It works through cert-manager.
- One token is for one CA. For two CAs, create two issuers.
- It needs Kubernetes 1.30 or newer and cert-manager 1.16 or newer.

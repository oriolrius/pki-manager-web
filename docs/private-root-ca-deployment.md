# Deploying a Private Root CA Certificate to Browsers and Client Devices

## 1. Objective

The purpose of this procedure is to make browsers and supported applications trust HTTPS certificates issued by a private Certificate Authority.

The public CA certificate will be referred to as:

```text

CA.crt

```

After the CA is correctly installed as a trusted root, a browser should accept server certificates issued by that CA without displaying errors such as:

```text

NET::ERR_CERT_AUTHORITY_INVALID

SEC_ERROR_UNKNOWN_ISSUER

MOZILLA_PKIX_ERROR_SELF_SIGNED_CERT

Your connection is not private

This Connection Is Not Private

```

Installing `CA.crt` solves only the **issuer trust** part of certificate validation. The HTTPS server certificate and the complete TLS configuration must still be correct.

---

# 2. What Must Be Distributed

## 2.1 Distribute only the public CA certificate

The file distributed to clients must contain the public certificate of the private root CA:

```text

CA.crt

```

It may also be named:

```text

CA.cer

root-ca.crt

root-ca.cer

company-root-ca.pem

```

The filename and extension are not the critical part. The important elements are:

- it is an X.509 CA certificate;
- it contains only public information;
- it corresponds to the CA that issued, directly or indirectly, the HTTPS server certificates;
- it does not contain a private key.

Never distribute any of the following:

```text

CA.key

root.key

private.key

ca-private-key.pem

*.p12

*.pfx

```

A root CA private key would allow its holder to issue certificates trusted by every device on which the CA has been installed.

## 2.2 Root CA versus intermediate CA

A common private PKI has this hierarchy:

```text

Private Root CA

    │

    └── Private Intermediate CA

            │

            ├── server01 certificate

            ├── portal.example.internal certificate

            └── api.example.internal certificate

```

Normally, clients should trust the **root CA**.

The server should present:

```text

Leaf/server certificate

Intermediate CA certificate

```

The server should normally not send the root certificate because clients already possess and trust it locally.

The validation path is:

```text

Server certificate

    │ signed by

    ▼

Intermediate CA

    │ signed by

    ▼

Trusted root CA installed on client

```

Installing only the intermediate CA as a trusted root can technically work in some environments, but it changes the intended trust boundary and is generally not the preferred PKI design.

## 2.3 Root certificate requirements

Before deployment, verify that `CA.crt` really is a CA certificate.

Inspect it with OpenSSL:

```bash

openssl x509 \

  -in CA.crt \

  -noout \

  -subject \

  -issuer \

  -serial \

  -dates \

  -fingerprint \

  -sha256 \

  -text

```

Look for:

```text

X509v3 Basic Constraints:

    CA:TRUE

```

Preferably, the extension should be marked critical:

```text

X509v3 Basic Constraints: critical

    CA:TRUE

```

The certificate should also normally contain an appropriate key-usage extension:

```text

X509v3 Key Usage: critical

    Certificate Sign, CRL Sign

```

For a self-signed root CA, the subject and issuer are normally identical:

```text

Subject: CN = Example Private Root CA

Issuer:  CN = Example Private Root CA

```

That alone does not prove that the certificate is legitimate. Compare its SHA-256 fingerprint against a value obtained through a trusted, independent channel.

---

# 3. Supported Certificate Encodings

## 3.1 PEM encoding

A PEM certificate is Base64-encoded text:

```pem

-----BEGIN CERTIFICATE-----

MIID...

...

-----END CERTIFICATE-----

```

Common extensions:

```text

.crt

.cer

.pem

```

PEM is commonly used by:

- Linux;
- OpenSSL;
- web servers;
- configuration-management systems.

## 3.2 DER encoding

A DER certificate is binary rather than Base64 text.

Common extensions:

```text

.cer

.der

.crt

```

Windows, Android, iOS and macOS can generally process DER-encoded certificates. Some import interfaces behave more consistently with DER than PEM.

## 3.3 Converting between PEM and DER

PEM to DER:

```bash

openssl x509 \

  -in CA.crt \

  -outform DER \

  -out CA.der

```

DER to PEM:

```bash

openssl x509 \

  -in CA.der \

  -inform DER \

  -outform PEM \

  -out CA.crt

```

The conversion changes only the representation. It does not change:

- the public key;
- the subject;
- the serial number;
- the validity period;
- the fingerprint of the certificate itself.

## 3.4 Recommended distribution files

For maximum compatibility, maintain both forms:

```text

CA.crt     # PEM

CA.cer     # DER

```

Before distribution, verify that both represent the same certificate:

```bash

openssl x509 -in CA.crt -noout -fingerprint -sha256

openssl x509 \

  -in CA.cer \

  -inform DER \

  -noout \

  -fingerprint \

  -sha256

```

The fingerprints must match.

---

# 4. Security Consequences of Installing a Private Root CA

Installing a root CA is a privileged and security-sensitive operation.

A device that trusts `CA.crt` will potentially accept any otherwise valid server certificate signed by that CA, including certificates for public Internet names.

For example, the CA could technically issue certificates for:

```text

[www.google.com](http://www.google.com)

[login.microsoftonline.com](http://login.microsoftonline.com)

bank.example

```

Whether an attacker could successfully use such certificates also depends on their ability to intercept or redirect traffic, but trusting the CA creates that possibility.

Therefore:

1. Protect the CA private key with strong access controls.
2. Distribute the public CA certificate over a controlled channel.
3. Verify the SHA-256 fingerprint before installation.
4. Document every device or fleet receiving the CA.
5. Define a removal and rollover procedure.
6. Do not tell users to install arbitrary certificates received by email.
7. Use MDM, Group Policy or another managed mechanism for organizational deployments.
8. Remove the CA when the device is retired or no longer requires access.

The fact that `CA.crt` does not contain a private key does not make installation harmless. The security impact comes from assigning trust to it.

---

# 5. Why Installing the CA May Still Not Fix the Browser

Installing the correct CA fixes only this condition:

```text

The certificate chain ends in an unknown CA.

```

The browser will still reject the connection if any other TLS validation requirement fails.

## 5.1 Missing Subject Alternative Name

Modern browsers validate hostnames against the certificate’s `subjectAltName` extension.

A certificate such as:

```text

Subject:

    CN = portal.example.internal

```

is not sufficient by itself.

It should contain:

```text

X509v3 Subject Alternative Name:

    DNS:portal.example.internal

```

For multiple names:

```text

X509v3 Subject Alternative Name:

    DNS:portal.example.internal

    DNS:portal

    DNS:www.portal.example.internal

```

The hostname entered into the browser must match a DNS SAN exactly, subject to standard wildcard rules.

## 5.2 Common Name alone is insufficient

Do not rely only on:

```text

CN=portal.example.internal

```

Issue certificates with a proper SAN extension.

## 5.3 Incorrect use of IP addresses

If users browse to:

```text

[https://192.168.1.50](https://192.168.1.50)

```

the certificate must contain an IP SAN:

```text

X509v3 Subject Alternative Name:

    IP Address:192.168.1.50

```

This is different from:

```text

DNS:192.168.1.50

```

An IP address must be encoded as an IP SAN, not as a DNS name.

A certificate containing only:

```text

DNS:portal.example.internal

```

is not valid when the user accesses the server using its IP address.

## 5.4 Missing intermediate certificate

The client should normally receive the intermediate certificate from the HTTPS server.

The server should present:

```text

server certificate

intermediate CA certificate

```

It should not rely on every browser having previously cached the intermediate.

A browser may work on one machine because the intermediate is cached and fail on a clean machine where it is absent.

## 5.5 Wrong Extended Key Usage

A server certificate should normally permit TLS server authentication:

```text

X509v3 Extended Key Usage:

    TLS Web Server Authentication

```

Its corresponding OID is:

```text

1.3.6.1.5.5.7.3.1

```

A certificate restricted to client authentication is not a valid server certificate:

```text

TLS Web Client Authentication

```

## 5.6 Invalid validity period

The server certificate must currently be valid:

```text

Not Before &lt;= current time &lt;= Not After

```

Check:

```bash

openssl x509 \

  -in server.crt \

  -noout \

  -dates

```

Also verify the client’s clock. Incorrect time, date or time zone can make a valid certificate appear not yet valid or expired.

## 5.7 Weak or obsolete algorithms

Avoid:

```text

MD5 signatures

SHA-1 signatures

RSA keys smaller than 2048 bits

obsolete elliptic curves

```

For broad compatibility, typical choices are:

```text

RSA 2048 or 3072 with SHA-256

ECDSA P-256 with SHA-256

```

## 5.8 CA constraints are incorrect

The root and intermediate certificates must be permitted to sign certificates:

```text

Basic Constraints: CA:TRUE

Key Usage: Certificate Sign

```

The leaf certificate should normally have:

```text

Basic Constraints: CA:FALSE

```

## 5.9 Certificate chain order is wrong

When creating a full-chain file, the order should normally be:

```text

-----BEGIN CERTIFICATE-----

Leaf/server certificate

-----END CERTIFICATE-----

-----BEGIN CERTIFICATE-----

Intermediate CA certificate

-----END CERTIFICATE-----

```

Do not put the root first.

Do not put the intermediate before the leaf.

---

# 6. Verify the CA Before Deploying It

## 6.1 Display the SHA-256 fingerprint

```bash

openssl x509 \

  -in CA.crt \

  -noout \

  -fingerprint \

  -sha256

```

Example:

```text

sha256 Fingerprint=

4A:CF:21:7E:53:92:5D:5A:...

```

## 6.2 Verify that the private and public keys correspond

This procedure should be performed only on the protected CA system where the private key is stored.

For an RSA key:

```bash

openssl x509 \

  -in CA.crt \

  -noout \

  -modulus |

openssl sha256

```

```bash

openssl rsa \

  -in CA.key \

  -noout \

  -modulus |

openssl sha256

```

The values must match.

A more general public-key comparison is:

```bash

openssl x509 \

  -in CA.crt \

  -pubkey \

  -noout |

openssl pkey \

  -pubin \

  -outform DER |

openssl sha256

```

```bash

openssl pkey \

  -in CA.key \

  -pubout \

  -outform DER |

openssl sha256

```

Again, the resulting hashes must match.

Do not perform this comparison on ordinary client devices because the private CA key should never be present there.

## 6.3 Verify a server certificate against the CA

For a directly issued server certificate:

```bash

openssl verify \

  -CAfile CA.crt \

  server.crt

```

Expected result:

```text

server.crt: OK

```

For an intermediate-based hierarchy:

```bash

openssl verify \

  -CAfile root-CA.crt \

  -untrusted intermediate-CA.crt \

  server.crt

```

---

# 7. Windows 10 and Windows 11

## 7.1 Windows certificate stores

Windows separates certificate stores by:

- user;
- machine;
- purpose.

The two most relevant scopes are:

```text

Current User

Local Computer

```

The important store is:

```text

Trusted Root Certification Authorities

```

Installing a certificate into:

```text

Personal

Intermediate Certification Authorities

Trusted Publishers

```

does not give it the same root trust semantics.

The Windows Trusted Root Certification Authorities store contains the root CAs that Windows trusts.

## 7.2 Machine-wide installation using certutil

Open Command Prompt or PowerShell **as Administrator**.

Run:

```cmd

certutil -addstore -f "ROOT" CA.crt

```

`certutil -addstore` adds a certificate to the specified Windows certificate store; `ROOT` selects Trusted Root Certification Authorities.

This is the preferred command for machine-wide manual deployment.

The parameters mean:

```text

-addstore    Add certificate to a store

-f           Force the operation

ROOT         Trusted Root Certification Authorities

CA.crt       Public CA certificate

```

## 7.3 Current-user installation

Without administrative access, a certificate can be added to the current user’s trusted-root store:

```cmd

certutil -user -addstore -f "ROOT" CA.crt

```

This affects only the current user.

It may be sufficient for browsers running under that account, but it will not necessarily cover:

- Windows services;
- other user accounts;
- service accounts;
- applications executing as Local System;
- background agents running under another identity.

For a shared or managed computer, prefer Local Computer installation.

## 7.4 Installation using the graphical interface

For machine-wide installation:

1. Press `Win + R`.
2. Run:

```text

certlm.msc

```

3. Navigate to:

```text

Trusted Root Certification Authorities

└── Certificates

```

4. Right-click **Certificates**.
5. Select **All Tasks → Import**.
6. Select `CA.crt` or `CA.cer`.
7. Explicitly place it in:

```text

Trusted Root Certification Authorities

```

8. Finish the wizard.
9. Open the installed certificate and verify its SHA-256 fingerprint.

Microsoft also documents importing roots through the Trusted Root Certification Authorities console.

For current-user installation, use:

```text

certmgr.msc

```

The distinction is:

```text

certlm.msc  → Local Computer

certmgr.msc → Current User

```

## 7.5 Verification

List the Local Computer root store:

```cmd

certutil -store ROOT

```

List the current-user root store:

```cmd

certutil -user -store ROOT

```

Search using part of the CA name:

```cmd

certutil -store ROOT "Example Private Root CA"

```

The exact display behavior depends on how uniquely the string identifies a certificate.

## 7.6 Chrome on Windows

Chrome on Windows normally integrates with the Windows certificate infrastructure. Once the CA is in the correct Trusted Root Certification Authorities store, fully close and reopen Chrome.

Closing only the visible window may not terminate every Chrome process. Check Task Manager or use:

```cmd

taskkill /IM chrome.exe /F

```

Then reopen the browser.

## 7.7 Microsoft Edge on Windows

Microsoft Edge also uses the Windows trust infrastructure for normal TLS server validation.

After installing the root:

1. Close every Edge window.
2. Ensure background Edge processes are stopped if necessary.
3. Restart Edge.
4. Load the HTTPS service again.

## 7.8 Firefox on Windows

Firefox deserves explicit treatment because its certificate behavior has historically differed from Chrome and Edge.

Current Firefox supports trusting private roots installed in the Windows operating-system certificate store through its enterprise-roots functionality. Mozilla recommends OS-root integration for adding private PKI trust to Firefox.

Check:

```text

about:config

```

Search for:

```text

security.enterprise_roots.enabled

```

Set it to:

```text

true

```

Restart Firefox.

Alternatively, import `CA.crt` directly into Firefox:

```text

Settings

→ Privacy &amp; Security

→ Certificates

→ View Certificates

→ Authorities

→ Import

```

Select the CA and enable trust for identifying websites.

Direct Firefox import creates browser-profile-specific trust. It may need to be repeated for:

- each Firefox profile;
- each operating-system user;
- each separately managed Firefox installation.

For managed Firefox installations, use enterprise policy:

```json

{

  "policies": {

    "Certificates": {

      "ImportEnterpriseRoots": true

    }

  }

}

```

Using operating-system roots is generally easier to maintain than importing the same CA manually into every Firefox profile.

## 7.9 Remove the CA from Windows

First locate it:

```cmd

certutil -store ROOT

```

Then delete it using a sufficiently unique certificate identifier:

```cmd

certutil -delstore ROOT "&lt;certificate-hash-or-name&gt;"

```

For the current user:

```cmd

certutil -user -delstore ROOT "&lt;certificate-hash-or-name&gt;"

```

The graphical alternative is:

```text

certlm.msc

→ Trusted Root Certification Authorities

→ Certificates

→ Select CA

→ Delete

```

Verify the fingerprint before deletion to avoid removing an unrelated root.

---

# 8. macOS

## 8.1 macOS trust stores

macOS stores certificates in keychains.

The relevant keychains are:

```text

login

System

System Roots

```

For a private organizational or local CA, install it into:

```text

System

```

when all users and system applications should trust it.

Use:

```text

login

```

only when trust should be limited to the current account.

Do not attempt to modify the protected Apple-managed `System Roots` keychain.

## 8.2 Installation using Keychain Access

1. Open **Keychain Access**.
2. Select the **System** keychain.
3. Drag `CA.crt` or `CA.cer` into Keychain Access, or use the import function.
4. Authenticate as an administrator.
5. Locate the imported CA under **Certificates**.
6. Double-click it.
7. Expand **Trust**.
8. Set:

```text

When using this certificate: Always Trust

```

9. Close the window.
10. Authenticate again if requested.

Apple documents adding certificates to either the login or System keychain by importing or dragging the certificate into Keychain Access.

Apple also documents changing the certificate’s trust policies from the Trust section of its Keychain Access entry.

## 8.3 Command-line installation

For machine-wide trust:

```bash

sudo security add-trusted-cert \

  -d \

  -r trustRoot \

  -k /Library/Keychains/System.keychain \

  CA.crt

```

Important parameters:

```text

-d           Add to an admin trust domain

-r trustRoot Treat certificate as a trusted root

-k           Destination keychain

```

For system-wide browser trust, the destination is:

```text

/Library/Keychains/System.keychain

```

## 8.4 Safari on macOS

Safari uses the macOS trust system.

After the CA is installed and marked trusted:

1. Quit Safari completely.
2. Reopen Safari.
3. Reload the HTTPS service.

In most cases, a full system restart is not required.

## 8.5 Chrome and Edge on macOS

Chrome and Edge on macOS use the platform’s certificate trust mechanisms for normal server-certificate validation.

Install the CA in the System keychain and configure its trust policy. Then fully restart the browser.

## 8.6 Firefox on macOS

Firefox may use operating-system enterprise roots when appropriately configured.

Check:

```text

about:config

```

Set:

```text

security.enterprise_roots.enabled = true

```

Alternatively, import the CA directly into Firefox:

```text

Settings

→ Privacy &amp; Security

→ Certificates

→ View Certificates

→ Authorities

→ Import

```

For managed environments, use Firefox enterprise policies instead of manually modifying each profile.

## 8.7 Verify installation

Using Keychain Access:

1. Select the System keychain.
2. Open Certificates.
3. Find the private root.
4. Compare its SHA-256 fingerprint.
5. Confirm that the trust setting is enabled.

From the command line:

```bash

security find-certificate \

  -a \

  -c "Example Private Root CA" \

  /Library/Keychains/System.keychain

```

## 8.8 Remove the CA from macOS

Using Keychain Access:

1. Open the System keychain.
2. Select the CA.
3. Confirm its fingerprint.
4. Delete it.
5. Authenticate as administrator.

From the command line, identify the certificate and remove it carefully using the `security` utility. Avoid deleting by an ambiguous common name where multiple certificates share the same name.

---

# 9. Linux Desktops

Linux trust deployment is less uniform because there may be several trust mechanisms:

```text

Operating-system CA bundle

NSS certificate database

Browser-specific certificate store

Application-specific certificate bundle

Container-specific certificate bundle

Language-runtime-specific store

```

Installing a CA in the operating-system trust store is necessary but may not be sufficient for every browser or application.

---

## 9.1 Debian and Ubuntu

The certificate must:

- be PEM encoded;
- have a `.crt` extension;
- contain one certificate per file.

Install it:

```bash

sudo cp CA.crt \

  /usr/local/share/ca-certificates/example-private-root-ca.crt

```

Update the trust store:

```bash

sudo update-ca-certificates

```

Ubuntu documents placing a PEM-formatted root CA in the local CA directory and running `update-ca-certificates`.

The tool incorporates `.crt` files found below:

```text

/usr/local/share/ca-certificates

```

into the machine trust bundle.

Expected output is similar to:

```text

Updating certificates in /etc/ssl/certs...

1 added, 0 removed; done.

```

## 9.2 Verify on Debian or Ubuntu

Check the generated links:

```bash

ls -l /etc/ssl/certs | grep -i example

```

Test OpenSSL:

```bash

openssl verify \

  -CApath /etc/ssl/certs \

  server.crt

```

Test an HTTPS endpoint:

```bash

curl -v [https://service.example.internal/](https://service.example.internal/)

```

A successful `curl` test verifies the system/OpenSSL trust path, but it does not guarantee that Firefox uses the same trust store.

## 9.3 Remove from Debian or Ubuntu

```bash

sudo rm \

  /usr/local/share/ca-certificates/example-private-root-ca.crt

sudo update-ca-certificates --fresh

```

Then restart affected browsers and applications.

## 9.4 Red Hat Enterprise Linux, Fedora, Rocky Linux and AlmaLinux

A common trust-anchor location is:

```text

/etc/pki/ca-trust/source/anchors/

```

Install:

```bash

sudo cp CA.crt \

  /etc/pki/ca-trust/source/anchors/example-private-root-ca.crt

```

Update:

```bash

sudo update-ca-trust extract

```

Verify using:

```bash

trust list | grep -A10 -B2 "Example Private Root CA"

```

Exact commands can vary by distribution and version.

## 9.5 Chrome and Chromium on Linux

Chrome and Chromium trust behavior on Linux depends on distribution integration and browser packaging.

Possible packaging differences include:

```text

native distribution package

Snap

Flatpak

vendor-supplied package

Chromium distribution package

```

Start by installing the CA into the operating-system trust store.

If Chrome or Chromium still rejects it:

1. Fully stop the browser.
2. Confirm that command-line tools trust the CA.
3. Inspect the browser certificate-management interface.
4. Check whether Snap or Flatpak sandboxing uses a different trust bundle.
5. Verify the browser package’s distribution-specific trust integration.

## 9.6 Firefox on Linux

Firefox may maintain an NSS certificate database distinct from the operating-system OpenSSL trust bundle.

The most deterministic manual procedure is:

```text

Firefox

→ Settings

→ Privacy &amp; Security

→ Certificates

→ View Certificates

→ Authorities

→ Import

```

Select `CA.crt` and enable trust for websites.

This trust is associated with the Firefox profile.

For multiple devices or profiles, prefer:

- Firefox enterprise policy;
- a managed NSS deployment;
- distribution-supported system-trust integration.

Do not assume that a successful `curl` test means Firefox will trust the CA.

---

# 10. Android Phones and Tablets

## 10.1 Important Android distinction

Android has at least two relevant trust sources:

```text

System-installed CAs

User-installed CAs

```

A manually installed private CA is normally placed in the **user credential store**, not in the read-only system CA store.

This distinction affects application behavior.

Installing the CA may allow the browser to trust local HTTPS sites, but it does not guarantee that every Android application will trust it.

## 10.2 Transfer the certificate

Transfer only the public certificate:

```text

CA.crt

```

or, when necessary for compatibility:

```text

CA.cer

```

Possible transfer mechanisms include:

- USB;
- managed file deployment;
- MDM;
- a controlled internal portal;
- secure messaging;
- email.

Email is convenient but weak as a trust-establishment method. The certificate fingerprint should be verified independently.

## 10.3 Manual installation

Android menu names vary substantially by:

- Android version;
- manufacturer;
- device management;
- work profile;
- security policy.

A common path is:

```text

Settings

→ Security &amp; privacy

→ More security settings

→ Encryption &amp; credentials

→ Install a certificate

→ CA certificate

```

Other manufacturers may show:

```text

Settings

→ Security

→ Credential storage

→ Install from storage

```

or:

```text

Settings

→ Biometrics and security

→ Other security settings

→ Install from device storage

→ CA certificate

```

Select:

```text

CA certificate

```

Do not select:

```text

VPN and app user certificate

Wi-Fi certificate

User identity certificate

```

The device will display a warning because a newly trusted CA can be used to inspect or authenticate encrypted connections.

A secure screen lock may be required.

## 10.4 Chrome on Android

Chrome on Android normally integrates with Android’s platform certificate validation.

After installing the CA:

1. Fully close Chrome.
2. Remove it from the recent-apps view.
3. Reopen it.
4. Load the HTTPS service.
5. Inspect the exact error if it still fails.

Potential remaining causes include:

- missing SAN;
- hostname mismatch;
- missing intermediate;
- expired certificate;
- unsupported certificate parameters;
- application or browser policy;
- managed-device restrictions.

## 10.5 Firefox on Android

Firefox on Android should be tested separately rather than assuming identical behavior to Chrome.

Mobile Firefox behavior can vary by:

- release;
- certificate implementation;
- Android version;
- enterprise configuration.

When a private root is not accepted, check Firefox’s current certificate settings and enterprise policy support for the specific deployed version.

Desktop Firefox’s certificate-import interface should not be assumed to exist in exactly the same form on Android.

## 10.6 Native Android applications are different from browsers

Android applications targeting Android 7.0/API level 24 or later do not automatically trust user-added CAs by default unless their Network Security Configuration permits that trust.

Therefore this result is possible:

```text

Chrome opens the site successfully.

The native Android app rejects the same certificate.

```

This does not necessarily mean the CA was installed incorrectly.

An application you control can explicitly trust user-added CAs.

`AndroidManifest.xml`:

```xml

&lt;application

    android:networkSecurityConfig="@xml/network_security_config"

    ...&gt;

&lt;/application&gt;

```

`res/xml/network_security_config.xml`:

```xml

&lt;?xml version="1.0" encoding="utf-8"?&gt;

&lt;network-security-config&gt;

    &lt;base-config&gt;

        &lt;trust-anchors&gt;

            &lt;certificates src="system" /&gt;

            &lt;certificates src="user" /&gt;

        &lt;/trust-anchors&gt;

    &lt;/base-config&gt;

&lt;/network-security-config&gt;

```

A safer domain-scoped configuration is:

```xml

&lt;?xml version="1.0" encoding="utf-8"?&gt;

&lt;network-security-config&gt;

    &lt;domain-config&gt;

        &lt;domain includeSubdomains="true"&gt;

            example.internal

        &lt;/domain&gt;

        &lt;trust-anchors&gt;

            &lt;certificates src="system" /&gt;

            &lt;certificates src="user" /&gt;

        &lt;/trust-anchors&gt;

    &lt;/domain-config&gt;

&lt;/network-security-config&gt;

```

Android officially provides Network Security Configuration for defining custom and user-supplied trust anchors.

## 10.7 Certificate pinning

An application using certificate or public-key pinning may reject the certificate even when:

- the private root CA is installed;
- the chain is valid;
- the hostname is correct;
- the browser accepts the site.

Installing `CA.crt` does not override application-level pinning.

## 10.8 Work profiles and managed devices

An Android work profile can have a different security policy and credential scope from the personal profile.

A CA installed in the personal profile may not be available to:

- work-profile applications;
- managed Chrome;
- corporate VPN components;
- managed network configurations.

For an organization, deploy the CA using Android Enterprise or MDM rather than relying on users to install it manually.

## 10.9 Removing the CA from Android

A typical path is:

```text

Settings

→ Security &amp; privacy

→ More security settings

→ Encryption &amp; credentials

→ Trusted credentials

→ User

```

or:

```text

Settings

→ Security

→ Encryption &amp; credentials

→ User credentials

```

Select the CA, verify its name and fingerprint where displayed, and remove it.

Avoid using a broad **Clear credentials** function unless removing every user-installed credential is intended.

---

# 11. iPhone and iPad

## 11.1 iOS and iPadOS require two operations

For a root CA installed manually from a downloaded or transferred certificate, there are two distinct steps:

```text

1. Install the certificate profile.

2. Enable full trust for the root certificate.

```

Completing only the first step is a very common cause of continuing TLS errors.

Apple explicitly states that SSL/TLS trust must be enabled manually for a root certificate installed from email or a website.

## 11.2 Transfer the CA

Transfer only:

```text

CA.crt

```

or:

```text

CA.cer

```

Common methods:

- AirDrop;
- secure email;
- a controlled HTTPS download;
- Apple Configurator;
- MDM;
- a signed configuration profile.

For anything beyond a few personal devices, a signed profile or MDM is preferable.

## 11.3 Step 1: Install the profile

Open the certificate file on the iPhone or iPad.

The device should indicate that a profile has been downloaded.

Then open:

```text

Settings

→ General

→ VPN &amp; Device Management

```

A temporary direct entry may also appear as:

```text

Settings

→ Profile Downloaded

```

Select the downloaded profile.

Review:

- the certificate name;
- the issuing entity;
- the profile source;
- any warnings.

Tap **Install** and enter the device passcode when requested.

At this point, the certificate is installed, but manual SSL/TLS trust may still be disabled.

## 11.4 Step 2: Enable full trust

Go to:

```text

Settings

→ General

→ About

→ Certificate Trust Settings

```

Under:

```text

Enable Full Trust for Root Certificates

```

enable the private CA.

Confirm the security warning.

Apple documents this exact second step for manually installed root certificates.

The final state must be:

```text

Profile installed: Yes

Full trust enabled: Yes

```

## 11.5 Safari on iPhone and iPad

Safari uses the iOS/iPadOS system trust configuration.

After installing the profile and enabling full trust:

1. Close Safari.
2. Remove it from the application switcher if necessary.
3. Reopen Safari.
4. Load the HTTPS site.
5. Check the exact error if it is still rejected.

Typical remaining errors include:

- hostname mismatch;
- missing SAN;
- expired leaf certificate;
- missing intermediate;
- invalid certificate purpose;
- incorrect device time.

## 11.6 Chrome, Edge and Firefox on iPhone and iPad

Browsers on iOS and iPadOS operate within Apple’s platform constraints and generally depend on the system networking and trust environment.

The private root should therefore be installed through the device’s certificate-profile mechanism and enabled under Certificate Trust Settings.

Do not expect a desktop-style browser-specific CA store to be the primary deployment method on iOS.

## 11.7 Managed iPhones and iPads

For multiple or corporate devices, use:

- Apple MDM;
- Apple Configurator;
- a signed configuration profile;
- automated device enrollment.

Managed deployment provides:

- centralized installation;
- consistent profile contents;
- inventory;
- controlled removal;
- less opportunity for users to install the wrong CA;
- easier CA rollover.

Apple’s deployment documentation distinguishes managed certificate delivery from manual profile installation.

## 11.8 Remove the CA from iPhone or iPad

First disable full trust:

```text

Settings

→ General

→ About

→ Certificate Trust Settings

```

Then remove the profile:

```text

Settings

→ General

→ VPN &amp; Device Management

→ Select profile

→ Remove Profile

```

Enter the device passcode when requested.

---

# 12. ChromeOS

## 12.1 Personal ChromeOS device

On an unmanaged ChromeOS device, certificate management is normally accessed through the operating system or Chrome settings.

Import the public CA certificate as a certificate authority and explicitly assign trust for HTTPS website identification.

Exact interface labels may vary by ChromeOS release.

## 12.2 Managed ChromeOS fleet

For managed devices, deploy the CA through the Google Admin console rather than manually importing it on each device.

Google documents importing a TLS/SSL CA into the Admin console and deploying it to ChromeOS devices.

Managed deployment is the preferred option for:

- schools;
- companies;
- kiosks;
- shared ChromeOS devices;
- large device fleets.

## 12.3 ChromeOS and Android applications

Android applications running on ChromeOS may not automatically share every certificate available to the ChromeOS browser environment.

Google provides certificate-synchronization controls for managed ChromeOS environments where Android applications require access to ChromeOS CA certificates.

Test these separately:

```text

Chrome browser on ChromeOS

Android app running on ChromeOS

Linux application running in Crostini

```

They may use different trust mechanisms.

---

# 13. Browser-Specific Summary

| Platform   | Chrome/Edge                              | Safari             | Firefox                                         |

| ---------- | ---------------------------------------- | ------------------ | ----------------------------------------------- |

| Windows    | Windows root store                       | Not applicable     | Windows enterprise roots or Firefox import      |

| macOS      | macOS Keychain                           | macOS Keychain     | Enterprise roots or Firefox import              |

| Linux      | Distribution/package dependent           | Not applicable     | Often Firefox/NSS import or managed integration |

| Android    | Android user CA store, subject to policy | Not applicable     | Must be tested for deployed mobile version      |

| iOS/iPadOS | Apple system trust                       | Apple system trust | Apple system trust                              |

| ChromeOS   | ChromeOS certificate management          | Not applicable     | Platform/package dependent                      |

The safest operational rule is:

```text

Install the CA in the operating-system trust store,

then explicitly test every required browser and application.

```

Do not assume that success in one browser proves that every browser or native application uses the same trust store.

---

# 14. Managed Deployment at Scale

Manual installation is appropriate for:

- a development workstation;
- a home lab;
- a small test environment;
- a few personally controlled devices.

For larger environments, use centralized deployment.

## 14.1 Windows Active Directory Group Policy

A typical domain deployment location is:

```text

Computer Configuration

→ Policies

→ Windows Settings

→ Security Settings

→ Public Key Policies

→ Trusted Root Certification Authorities

```

Import the public CA certificate there.

Use computer policy when the trust must apply machine-wide.

Advantages:

- automatic installation;
- consistent scope;
- centralized updates;
- removal through policy;
- no user interaction;
- support for domain-joined computers.

## 14.2 Microsoft Intune

Use a trusted-certificate profile to deploy the root CA to managed:

- Windows devices;
- Android devices;
- iOS/iPadOS devices;
- macOS devices.

Keep the trusted-root profile separate from any client identity or SCEP/PKCS profile.

## 14.3 Apple MDM

Deploy a certificate payload containing the root CA.

Use MDM for:

- supervised iPhones;
- managed iPads;
- managed Macs;
- certificate rollover;
- removal when management ends.

## 14.4 Android Enterprise

Deploy the CA using the device-management policy appropriate to:

- fully managed devices;
- dedicated devices;
- corporate-owned work profiles;
- personally owned work profiles.

Confirm whether the CA is available to:

- all device applications;
- only work-profile applications;
- managed Chrome;
- specific managed network configurations.

## 14.5 Firefox enterprise policy

Example policy:

```json

{

  "policies": {

    "Certificates": {

      "ImportEnterpriseRoots": true

    }

  }

}

```

Where direct certificate installation into Firefox is required, use Mozilla’s supported enterprise certificate policies rather than scripting profile internals.

---

# 15. End-to-End Verification

## 15.1 Inspect the certificate served by the HTTPS endpoint

```bash

openssl s_client \

  -connect service.example.internal:443 \

  -servername service.example.internal \

  -showcerts

```

The `-servername` argument sends Server Name Indication and is essential when multiple HTTPS names share an endpoint.

## 15.2 Display the received leaf certificate

```bash

openssl s_client \

  -connect service.example.internal:443 \

  -servername service.example.internal \

  &lt;/dev/null 2&gt;/dev/null |

openssl x509 \

  -noout \

  -subject \

  -issuer \

  -serial \

  -dates \

  -fingerprint \

  -sha256 \

  -ext subjectAltName \

  -ext extendedKeyUsage

```

Verify:

```text

Subject: expected service identity

Issuer: expected private CA or intermediate

Validity: current

SAN: exact hostname used in browser

EKU: TLS Web Server Authentication

```

## 15.3 Verify with a specific CA without installing it

```bash

curl \

  --cacert CA.crt \

  -v \

  [https://service.example.internal/](https://service.example.internal/)

```

This isolates server-certificate correctness from operating-system trust installation.

Interpretation:

```text

curl --cacert works

browser fails

```

Likely causes:

- CA not installed in the browser’s effective trust store;
- browser process not restarted;
- Firefox-specific trust;
- browser policy;
- application-specific validation.

If:

```text

curl --cacert fails

```

the problem is probably not simply local CA installation. Inspect:

- hostname;
- SAN;
- chain;
- intermediate;
- validity;
- key usage;
- endpoint configuration.

## 15.4 Verify using the operating-system trust store

After installation:

```bash

curl -v [https://service.example.internal/](https://service.example.internal/)

```

Do not supply `--cacert`.

Success indicates that `curl` and its TLS backend can locate the root through the system trust configuration.

## 15.5 Verify the chain explicitly

Direct root issuer:

```bash

openssl verify \

  -CAfile CA.crt \

  server.crt

```

Intermediate issuer:

```bash

openssl verify \

  -CAfile root-CA.crt \

  -untrusted intermediate-CA.crt \

  server.crt

```

## 15.6 Verify hostname matching

```bash

openssl verify \

  -CAfile CA.crt \

  -verify_hostname service.example.internal \

  server.crt

```

For an IP address:

```bash

openssl verify \

  -CAfile CA.crt \

  -verify_ip 192.168.1.50 \

  server.crt

```

---

# 16. Troubleshooting by Browser Error

## 16.1 `NET::ERR_CERT_AUTHORITY_INVALID`

Likely causes:

- root CA not installed;
- CA installed in the wrong store;
- wrong CA installed;
- server certificate issued by another CA;
- missing intermediate;
- browser does not use the expected system trust store.

## 16.2 `SEC_ERROR_UNKNOWN_ISSUER`

Common in Firefox.

Likely causes:

- Firefox is not using operating-system enterprise roots;
- CA not imported into Firefox;
- missing intermediate;
- wrong certificate chain.

Check:

```text

security.enterprise_roots.enabled

```

## 16.3 `NET::ERR_CERT_COMMON_NAME_INVALID`

This usually means trust is not the main problem.

Check:

- exact browser hostname;
- certificate SAN;
- whether an IP was used;
- wildcard scope.

## 16.4 `NET::ERR_CERT_DATE_INVALID`

Check:

- client date and time;
- `Not Before`;
- `Not After`;
- certificate renewal;
- CA validity;
- intermediate validity.

## 16.5 `ERR_CERT_INVALID`

This is generic and may indicate:

- malformed certificate;
- invalid signature;
- unsupported key;
- invalid basic constraints;
- invalid usage;
- chain-building failure.

Inspect the certificate using OpenSSL.

## 16.6 Browser works, command-line application fails

The application may use:

- its own CA bundle;
- Java truststore;
- Python `certifi`;
- Node.js CA bundle;
- an embedded OpenSSL bundle;
- a container-local CA store.

Installing the CA in the browser or operating system may not update those stores.

## 16.7 Command-line application works, browser fails

Likely causes:

- browser-specific store;
- Firefox NSS database;
- browser not restarted;
- managed browser policy;
- profile-specific trust;
- browser-specific certificate restrictions.

## 16.8 Desktop browser works, mobile application fails

Likely causes:

- CA not installed on the mobile device;
- iOS full trust not enabled;
- Android app does not trust user-added CAs;
- certificate pinning;
- work-profile separation;
- mobile endpoint using a different hostname.

## 16.9 One mobile browser works and another fails

Do not assume all mobile browsers use identical trust behavior.

Record:

- OS version;
- browser and version;
- personal versus managed profile;
- whether the CA is user-installed or managed;
- exact error;
- exact hostname.

---

# 17. CA Renewal and Rollover

A root CA should not be replaced without planning.

If the existing CA expires or is replaced abruptly, every certificate issued under it can become untrusted on every client simultaneously.

## 17.1 Safe rollover procedure

1. Create the new CA securely.
2. Keep the old CA trusted during migration.
3. Distribute the new public CA certificate.
4. Verify that clients trust both old and new roots.
5. Begin issuing server certificates under the new hierarchy.
6. Replace server certificates gradually.
7. Test every required platform.
8. Remove the old CA only after no active certificate depends on it.
9. Document the old CA’s retirement.

During the overlap:

```text

Trusted roots:

    Old private root CA

    New private root CA

```

After migration:

```text

Trusted roots:

    New private root CA

```

## 17.2 Do not reuse the same subject carelessly

Two root certificates can have the same subject name but different keys.

For example:

```text

CN=Example Private Root CA

```

may exist in both an old and new certificate.

Always identify roots using:

- SHA-256 fingerprint;
- serial number;
- validity period;
- subject key identifier.

Do not identify a root only by its display name.

---

# 18. Recommended Deployment Checklist

## Certificate preparation

```text

[ ] CA.crt contains only the public root certificate

[ ] No private key is included

[ ] Basic Constraints contains CA:TRUE

[ ] Key Usage permits Certificate Sign

[ ] SHA-256 fingerprint has been recorded

[ ] PEM and DER versions have matching fingerprints

[ ] CA validity period has been checked

```

## Server-certificate preparation

```text

[ ] Server certificate is currently valid

[ ] Exact browser hostname appears in subjectAltName

[ ] IP access uses an IP SAN when applicable

[ ] Extended Key Usage permits TLS Web Server Authentication

[ ] Server sends required intermediate certificates

[ ] Server does not depend on cached intermediates

[ ] Chain order is leaf followed by intermediate

```

## Windows

```text

[ ] CA installed in Trusted Root Certification Authorities

[ ] Correct machine or user scope selected

[ ] Fingerprint verified after installation

[ ] Chrome restarted and tested

[ ] Edge restarted and tested

[ ] Firefox enterprise roots or direct import tested

```

## macOS

```text

[ ] CA installed in System keychain

[ ] Trust configured appropriately

[ ] Fingerprint verified

[ ] Safari tested

[ ] Chrome/Edge tested

[ ] Firefox tested separately

```

## Linux

```text

[ ] CA installed in distribution trust directory

[ ] Trust-update command executed

[ ] curl/OpenSSL tested

[ ] Chrome or Chromium tested

[ ] Firefox tested separately

[ ] Snap/Flatpak packaging considered

```

## Android

```text

[ ] CA installed specifically as a CA certificate

[ ] User or work-profile scope understood

[ ] Chrome tested

[ ] Other required browsers tested separately

[ ] Native applications tested separately

[ ] Certificate pinning considered

```

## iPhone and iPad

```text

[ ] Certificate profile installed

[ ] Full trust enabled separately

[ ] Safari restarted and tested

[ ] Other required browsers tested

[ ] Profile removal procedure documented

```

## Managed deployment

```text

[ ] Central deployment mechanism selected

[ ] Device targeting documented

[ ] Fingerprint verified in deployment package

[ ] Removal policy defined

[ ] CA rollover procedure defined

[ ] Lost or retired device process defined

```

---

# 19. Final Operational Model

Successful private-CA browser trust requires all of the following:

```text

1. The correct public root CA is installed in the effective trust store.

2. The server sends a valid leaf certificate.

3. The server sends every required intermediate certificate.

4. The hostname matches a SAN in the leaf certificate.

5. The certificate is valid at the client’s current date and time.

6. The certificate permits TLS server authentication.

7. The browser or application accepts the selected trust store.

8. No application-level certificate pinning rejects the chain.

```

The most important platform-specific points are:

```text

Windows:

Install into Trusted Root Certification Authorities, preferably

at Local Computer scope.

Firefox:

Verify operating-system enterprise-root integration or import

the CA explicitly.

macOS:

Install into the System keychain and set the required trust policy.

Linux:

Update the operating-system trust store, but test Firefox and

sandboxed browser packages separately.

Android:

Install as a CA certificate, but do not assume native applications

trust user-added CAs.

iPhone and iPad:

Install the profile and then separately enable Full Trust under

Certificate Trust Settings.

```

A certificate warning should never be bypassed merely by clicking through it. The correct solution is to establish a valid certificate chain, install the intended trust anchor through a controlled process, and verify the certificate identity and fingerprint on every target platform.


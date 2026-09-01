# Host & client setup

> **Zones:** if this installation uses [SSH zones](zones.md), every trust file
> below (User CA key, `@cert-authority` line, host cert, KRL) is **per zone** — a
> host trusts only its own zone's user CAs. Fetch trust material from the
> zone-scoped endpoints (`/ssh/zones/<zone>/…`) or, for a single-zone install, the
> unchanged default-zone routes.


How to set up an **SSH server** and an **SSH client** by hand. For automated host
setup, use the [Ansible role](../../ansible/README.md) instead — it performs the
server steps below. Read [the concept page](concept.md) first.

---

## SSH server (host admin)

Goal: the server presents its own host certificate **and** trusts user
certificates signed by the User CA.

### Prerequisites

- **NTP/chrony running** (certificate validity depends on the clock).
- The local **accounts** your principals map to (e.g. `root`, `deploy`) already
  exist.

### Steps

1. **Generate the host key on the node** (the private key never leaves it), and
   send only the public key to the operator:

   ```bash
   sudo ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" -q   # usually already present
   cat /etc/ssh/ssh_host_ed25519_key.pub          # send THIS to the operator
   ```

2. Get the **deploy bundle** from the operator (the host detail page → *Files to
   place on this server*). Place each file at the path shown. It contains:

   | File | Path | Mode |
   |---|---|---|
   | Host certificate | `/etc/ssh/ssh_host_ed25519_key-cert.pub` | `0444` |
   | User CA public key | `/etc/ssh/ssh-user-ca.pub` | `0444` |
   | sshd drop-in | `/etc/ssh/sshd_config.d/60-ssh-ca.conf` | `0644` |
   | AuthorizedPrincipals (per account) | `/etc/ssh/auth_principals/<account>` | `0644` |

   The drop-in contains:

   ```
   HostKey /etc/ssh/ssh_host_ed25519_key
   HostCertificate /etc/ssh/ssh_host_ed25519_key-cert.pub
   TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub
   AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
   RevokedKeys /etc/ssh/revoked_keys
   ```

   > If your host key is **not** ed25519, the bundle already adjusts the
   > `HostKey`/`HostCertificate` paths to match (e.g. `ssh_host_ecdsa_key`).

3. **Set up the KRL file.** `RevokedKeys` gates *user* logins, so the server
   serves the **User CA's** KRL (revoked user certificates). The file must exist
   or sshd refuses to start. The bundle's KRL snippet does this:

   ```bash
   sudo install -m 0444 /dev/null /etc/ssh/revoked_keys
   # then refresh on a schedule (cron), replacing YOUR-PKI-HOST:
   */15 * * * * root curl -fsS -o /etc/ssh/revoked_keys.new "https://YOUR-PKI-HOST/krl/<UserCaId>.bin" \
     && install -m 0444 -o root -g root /etc/ssh/revoked_keys.new /etc/ssh/revoked_keys
   ```

4. **Validate and reload** (reload, not restart — OpenSSH re-reads the cert, trust
   anchors, and KRL per authentication):

   ```bash
   sudo sshd -t && sudo systemctl reload ssh    # unit is "ssh" on Debian/Ubuntu, "sshd" on RHEL
   ```

### "Valid certificate but Permission denied"

Almost always the **principal-in-two-places** rule: the principal in the user's
cert is not in this host's `/etc/ssh/auth_principals/<account>` for the account
they're logging into. Re-check the mapping on the Principals page and that the
file was deployed.

---

## SSH client (end user)

Goal: log in with a User CA-signed certificate instead of copying a public key
into `authorized_keys`.

1. **Have a key** (the certificate signs your existing public key):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519     # if you don't have one
   cat ~/.ssh/id_ed25519.pub                       # send ONLY this to the operator
   ```

2. **Save the certificate** the operator returns next to your private key, with a
   matching base name and `-cert.pub` suffix — `ssh` then presents it
   automatically:

   ```bash
   # paste into ~/.ssh/id_ed25519-cert.pub
   chmod 644 ~/.ssh/id_ed25519-cert.pub
   ```

3. *(Optional)* add a `~/.ssh/config` block (scope the `Host` pattern to your
   fleet):

   ```
   Host *.example.com
     IdentityFile ~/.ssh/id_ed25519
     CertificateFile ~/.ssh/id_ed25519-cert.pub
     IdentitiesOnly yes
   ```

4. **Trust the servers' Host CA** so host-key warnings stop — add the Host CA
   `@cert-authority` line to `~/.ssh/known_hosts` (the operator provides it, or
   `curl https://YOUR-PKI-HOST/ssh/cert-authority?pattern=*.example.com`).

5. **Verify and log in**:

   ```bash
   ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub     # check principals, validity, options
   ssh <account>@server.example.com                # account must map to one of your principals
   ```

When the certificate expires (~1 week), request a fresh one the same way — no new
key needed.

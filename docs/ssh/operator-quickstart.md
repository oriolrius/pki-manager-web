# Operator quickstart — zero to first login

The ordered path through the web UI. The SSH landing page (`/ssh`) shows the same
steps as a live checklist that unlocks each step as you go. Read
[the concept page](concept.md) first if you haven't.

## 1. Create the dual CA

`/ssh` → **Certificate Authorities** → **Create SSH CA**

- Create a **User CA** (`caType: user`) — signs people's login certs.
- Create a **Host CA** (`caType: host`) — signs servers' host certs.

Both are required and come first. (Admin-only; the Cosmian KMS must be reachable.)

## 2. Distribute CA trust

Open each CA at **Certificate Authorities → (the CA)**:

- **User CA** → copy the *TrustedUserCAKeys* block; it goes on every **server** at
  `/etc/ssh/ssh-user-ca.pub`.
- **Host CA** → copy the editable `@cert-authority` line; it goes on every
  **client** in `~/.ssh/known_hosts`. Narrow the `*.example.com` pattern to your
  fleet.

## 3. Register a host and install its bundle

**Hosts → Register Host**

- Enter the FQDN and paste the server's **public** host key
  (`/etc/ssh/ssh_host_ed25519_key.pub`). The app rejects private keys.
- Leave *Issue a host certificate immediately* on.

Then open the host detail page → **Files to place on this server**. That one panel
contains *everything* the server needs: the host certificate, the User CA public
key, the sshd drop-in, the `auth_principals` files, and a KRL refresh snippet —
plus the validate-and-reload command. (See [Host & client setup](setup.md) for
the manual steps.)

## 4. Define principals and map them to accounts

**Principals**

- Add role names under **Principal catalog** (e.g. `admins`).
- Under **Map principals to host accounts**, map each principal to a local account
  on a host (e.g. `admins → root`). This renders the exact
  `/etc/ssh/auth_principals/<account>` file. After deploying it, click **Mark
  pushed** to clear the *Stale* badge.

> A principal only grants login where it is mapped to an account. See the concept
> page's "#1 trap".

## 5. Issue a user certificate

**Users → New Identity**, then **Issue Certificate** (`/ssh/users/new`):

- Pick the identity, add **at least one principal that matches a mapping from
  step 4** (the form shows you where each principal grants login), choose
  extensions/TTL, and paste the user's **public** key.
- The success screen gives the user everything: the certificate (named to match
  their key type), an optional `~/.ssh/config`, the Host CA `@cert-authority`
  line, and the verify/login commands. Deliver these out-of-band.

## 6. Revoke (only when needed)

**KRL** → pick a CA → revoke by serial/key/cert → **Generate KRL**.

Generate only updates PKI Manager — each host must fetch `/krl/<caId>.bin` into
`/etc/ssh/revoked_keys` (the host deploy panel includes a cron snippet). Prefer
letting the short TTL expire; use the KRL for emergencies.

---

Automation (unattended Ansible/CI signing via fleet tokens, the external
`/api/v1/external/ssh/*` endpoints, and the ECIES KRL puller) is **API-only** for
now — see [the API contract](../ssh-api-contract.md).

# SSH Certificate Manager — how it works

Read this once before using the SSH section. It is the mental model the rest of
the guides assume.

PKI Manager is an **OpenSSH certificate authority**. It runs **two** CAs (both
keys live safely inside the KMS):

- a **User CA** that signs *people's* login certificates, and
- a **Host CA** that signs *servers'* host certificates.

## Two trust directions (easy to mix up)

Trust flows in two directions, and they are symmetric:

| Direction | What you install | Where |
|---|---|---|
| **Servers trust users** | the **User CA** public key | `/etc/ssh/ssh-user-ca.pub` (referenced by `TrustedUserCAKeys`) on each server |
| **Clients trust servers** | the **Host CA** `@cert-authority` line | `~/.ssh/known_hosts` on each client |

## Principals — the #1 trap

A **principal** is just a role label (e.g. `admins`). For a login to succeed the
**same** principal must appear in **two** places:

1. inside the **user's certificate**, and
2. in the server's **`/etc/ssh/auth_principals/<account>`** file for the local
   account being logged into.

If it is in only one place, OpenSSH accepts the certificate signature but **still
denies the login**. This is the most common mistake. The web UI's *Issue User
Certificate* form shows you exactly where each principal is mapped so you can
catch this before issuing.

## Everything is copy-paste — nothing is pushed

PKI Manager **generates** the exact files (host cert, sshd drop-in, User CA file,
`auth_principals`, signed user cert, client config). It does **not** push anything
to your machines — you place the files yourself (manually, or with the bundled
Ansible role). "Generate KRL" and "Mark pushed" only update PKI Manager's own
state.

## Revocation is two-tier

- **Short lifetimes are the primary mechanism**: user certs last ~1 week, host
  certs ~1 year. Expiry *is* the main revocation — just re-issue.
- The **KRL** is the **emergency kill switch** for a key you must revoke
  immediately. A server's `RevokedKeys` gates *user* logins, so each server
  fetches the **User CA's** KRL (`/krl/<userCaId>.bin`) into
  `/etc/ssh/revoked_keys`. (Host-cert revocation is enforced client-side.)

## Zones — the trust boundary (optional)

By default everything above lives in a single trust domain. If you need **several
independent SSH trust domains** in one PKI Manager — prod vs staging, customer A
vs customer B — put them in separate **zones**. A zone is a real trust boundary,
not a label: each zone has its **own** User CA and Host CA, and **a host in a zone
trusts only that zone's user CAs**. Hosts, identities and principals each belong
to exactly one zone; the same FQDN or principal name can be reused across zones.
A single-zone install behaves exactly as this guide describes and needs nothing
new. Full model: **[SSH Zones](zones.md)**.

## Prerequisite everywhere: an accurate clock

Certificate validity (and KRL freshness) depend on time, so **NTP/chrony must be
running** on every server and client.

## The order to follow

1. Create **both** CAs (User + Host).
2. Hand out CA trust (User CA → servers, Host CA → clients).
3. Register each host and install its deploy bundle.
4. Define principals and map them to accounts on each host.
5. Issue user certs whose principals match those mappings.
6. Revoke via short TTL, or the KRL when urgent.

→ Next: [Deploy a server **and** a user (end-to-end reference)](deploy-server-and-user.md) ·
[Operator quickstart](operator-quickstart.md) ·
[Host & client setup](setup.md) ·
[Principals guide](principals-guide.md) ·
[Per-host access blocks](host-blocks-runbook.md) ·
[SSH Zones](zones.md) · [Zones migration runbook](zones-migration-runbook.md) ·
[Automation API contract](../ssh-api-contract.md)

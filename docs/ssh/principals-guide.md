# SSH Principals — a practical guide

Principals are the piece that makes the whole SSH CA "click", and they are the
#1 thing people get stuck on. This guide fixes the mental model and then walks a
concrete fleet (20 servers, three user profiles) end to end. Read
[concept.md](concept.md) first — this guide assumes its two-CA, two-trust-direction
model.

## The mental unlock: what a principal actually is

The usual blocker is the same every time: people think a principal is **a user**
or **a permission**. It is neither.

> **A principal is a role label.** It has no power on its own. Power appears only
> when **both sides agree** on that label.

It is exactly like a **Unix group** or an **OAuth scope**: the string
`developers` does nothing until a server decides to honor it for a specific local
account.

That is the "two-sides rule" from [concept.md](concept.md). A login succeeds
**only if the same principal appears in two places at once**:

1. **Inside the person's certificate** (who they are / what roles they hold) —
   you decide this **when you issue the cert**.
2. **In the server's `/etc/ssh/auth_principals/<account>` file** (which roles may
   enter that local account) — you decide this **per host**.

```
login allowed  ⇔  { principals in cert }  ∩  { principals in auth_principals/<account> }  ≠  ∅
```

If the label is in only one place, OpenSSH validates the certificate **signature**
but **denies the login**. This is the single most common mistake.

### The real insight: you split TWO decisions that used to be one

| Decision | Where it lives | How often it changes | Follows… |
|---|---|---|---|
| **Identity / role** (which principals the cert carries) | in the certificate, at issue time | rarely (job change) | **the person** |
| **Access policy** (which principals an account honors) | in each host's `auth_principals/*` | when the infra changes | **the server** |

This is what makes it **scale**: adding a new server **touches nobody's
certificate**; onboarding a person **touches no server**. The exact opposite of
`authorized_keys`, where every new person means editing N machines.

**Design golden rule:** principals encode **durable roles** (few labels, stable).
Do the per-environment / per-host slicing in the **mapping**
(`auth_principals`), not by inflating the number of principals.

## Worked example: 20 servers, 3 profiles

Split the fleet by **class**, not by exact count:

| Server class | Example | Why we separate it |
|---|---|---|
| **Client production** (8) | `acme-{web,db,app}`, `globex-{web,db}`, `initech-{web,db}` | Trust boundary / contractual isolation between clients |
| **Dev** (6) | `dev-01…06` | Sandbox, low risk |
| **Internal services** (6) | `ci`, `monitor`, `db-int`, `vault`, `logs`, `backup` | Own infra, sensitive access |

### Principal catalog

Use a **prefix** so you never mix dimensions (role vs. client). Three families:

| Principal | Family | Meaning | Who carries it in the cert |
|---|---|---|---|
| `developers` | role | Programmer | all devs |
| `sysadmins` | role | System administrator | all admins |
| `security` | role | Security team / CISO | security team |
| `client-acme` | tenant scope | Assigned to client Acme | only devs on that account |
| `client-globex` | tenant scope | … | … |
| `client-initech` | tenant scope | … | … |
| `break-glass` | special | Emergency root, very short TTL, heavily audited | nobody by default; issued ad hoc |
| `u:oriol.rius` | personal (optional) | Personal label for **traceability** in sshd logs | everyone (but **never** mapped) |

> On `u:oriol.rius`: it grants access to nothing (no `auth_principals` lists it).
> It exists so sshd logs **which principal matched**, letting you correlate
> exactly who logged in. An optional but very useful audit pattern, especially
> for the CISO.

### What each profile carries in the certificate

| Person | Principals in cert | Rationale |
|---|---|---|
| Junior dev on Acme | `developers client-acme u:ana` | Role + **only** the client they work on (least privilege) |
| Senior dev (Acme + Globex) | `developers client-acme client-globex u:pau` | Two scopes because they touch two accounts |
| Sysadmin | `sysadmins u:marta` | The admin role is mapped everywhere; no client scope needed |
| CISO / security | `security u:oriol` | **Read-only / audit**. **NEVER** `sysadmins` → *separation of duties* |
| Emergency | `break-glass` (+ whatever is needed) | Ephemeral cert, issued by hand, mandatory post-review |

**Note the CISO:** they do *not* carry `sysadmins`. A security lead who can become
root everywhere breaks separation of duties (they could alter the very logs they
audit). Give them a read-only `audit` account across the fleet. If they ever need
root, they go through `break-glass` (and it is recorded).

### Mapping principals per server class (`auth_principals/<account>`)

This is where you decide **who reaches where**, without touching any cert:

**DEV servers** (permissive):

```
/etc/ssh/auth_principals/deploy   →  developers sysadmins
/etc/ssh/auth_principals/root     →  sysadmins
/etc/ssh/auth_principals/audit    →  security
```

**INTERNAL services** (devs enter the app account, not root):

```
/etc/ssh/auth_principals/appsvc   →  developers sysadmins
/etc/ssh/auth_principals/root     →  sysadmins
/etc/ssh/auth_principals/audit    →  security
```

**CLIENT production — e.g. Acme's servers** (per-tenant isolation):

```
/etc/ssh/auth_principals/deploy   →  client-acme sysadmins
/etc/ssh/auth_principals/root     →  sysadmins break-glass
/etc/ssh/auth_principals/audit    →  security
```

The key trick for client prod: on the `deploy` account you do **not** put
`developers`, you put **`client-acme`**. So:

- An Acme dev gets in (they carry `client-acme`).
- A Globex dev does **not** get into Acme (no `client-acme`), even though they are
  `developers`. → Cross-client data isolation, for free.
- `sysadmins` reach everywhere (fleet operations).
- `security` has its `audit` account on **every** machine, read-only.
- `break-glass` opens root only, and only when explicitly issued.

## Purpose and criteria of each piece (the "why")

| Piece | Purpose | Provisioning criterion |
|---|---|---|
| **Roles** (`developers`, `sysadmins`, `security`) | Stability: they follow the person, change rarely | Derive them from your **IdP group membership** (Keycloak) if you can; 1 role = 1 group |
| **Tenant scopes** (`client-*`) | Least privilege + client isolation | Issue them **only** to devs actually assigned to that client |
| **Personal** (`u:*`) | Fine-grained traceability / audit | To everyone; never in the mapping |
| **`break-glass`** | Break the glass in an emergency | **Ephemeral** cert (hours), issued by hand, alert + post-mortem review |
| **Short TTL** (~1 week, the tool's default) | The cert *is* the revocation: a role change propagates by itself on the next issuance | Do not lengthen user-cert TTL |
| **Per-host block** (composed KRL, the *access block*) | Cut off **this person on this host** now, without waiting for the TTL | Orthogonal to principals: one reversible, audited click; lands within ≤1 pull interval (~7–15 min) |

Two things people conflate, worth stating plainly:

- **Principals ≠ revocation.** Principals decide access *at issue/mapping time*.
  To remove access **now** you have two different levers: let the cert expire
  (short TTL) or the **per-host block** (KRL). A principal change only takes
  effect on the **next cert issued**.
- **Do not put usernames as mapping principals.** It couples the cert to a
  specific account and kills the role model. The personal name goes as `u:*`
  **for logs only**, not to grant access.

## The onboarding flow, condensed

1. Create the **two CAs** (User + Host) — once.
2. Hand out trust: User CA → servers (`TrustedUserCAKeys`); Host CA → clients
   (`known_hosts`).
3. Register each host and, by its **class**, install the `auth_principals/*`
   above (by hand or with the bundled [Ansible role](../../ansible/README.md)).
4. Issue each person's cert with **their role + their scopes** (the *Issue User
   Certificate* form shows you where each principal maps → lets you catch the
   trap before issuing).
5. Role change → re-issue (or wait for expiry). Incident → **per-host block**.

The takeaway: **you add a new server by touching only its `auth_principals` (the
server's policy); you onboard a person by touching only their cert (the person's
identity).** Principals are the shared vocabulary that keeps those two decisions
from ever having to be coordinated.

→ Related: [concept.md](concept.md) ·
[Operator quickstart](operator-quickstart.md) ·
[Host & client setup](setup.md) ·
[Per-host access blocks](host-blocks-runbook.md)

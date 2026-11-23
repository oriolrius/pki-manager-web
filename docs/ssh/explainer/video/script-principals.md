# Principals in depth: video script (series 2)

Follow-up series to [`script.md`](script.md) (episodes 01–10). Audience: sysadmins who watched
the first series, or know the basics: User CA, Host CA, the two-places rule. Goal: design,
operate and audit principals in a real fleet, and get the most out of them.

Same conventions as series 1 (one idea per scene, **Narration** read word for word,
**Visual** = what the animation shows, same colour code). Voice: VoiceStudio profile
`dbai24-narrator-vox48` (female, native English). Pace ~150 words per minute.

Source material: [`docs/ssh/principals-guide.md`](../../principals-guide.md), checked against
the code. Facts that the code changes compared with the guide are listed at the end
([Corrections to the guide](#corrections-to-the-guide)).

Running example for the whole series: **your team runs one fleet for three customers**,
Acme, Globex and Initech, plus your own dev and internal servers.

| Class | Servers | Why separate |
|---|---|---|
| Customer production | `acme-web`, `acme-db`, `acme-app`, `globex-web`, `globex-db`, `initech-web`, `initech-db` | contractual isolation between customers |
| Dev | `dev-01` … `dev-06` | sandbox, low risk |
| Internal | `ci`, `monitor`, `vault`, `logs`, `backup`, `db-int` | your own sensitive services |

People: **Ana** (junior developer on Acme), **Pau** (senior developer on Acme and Globex),
**Marta** (sysadmin), **Sara** (security lead). Robots: the **deploy pipeline**, the
**backup job**.

| # | Episode | Target |
|---|---|---|
| 11 | Under the hood: what sshd really checks | 2:00 |
| 12 | Designing your principal catalog | 2:00 |
| 13 | Mapping a real fleet | 2:15 |
| 14 | People and profiles | 2:00 |
| 15 | Customer isolation | 2:00 |
| 16 | Break-glass and temporary access | 2:00 |
| 17 | Robots, pipelines and restricted certificates | 2:15 |
| 18 | Changes over time, and who did what | 2:15 |
| 19 | Anti-patterns and a checklist | 2:00 |

> **Product gap — decide before recording.** PKI Manager can add a principal→account mapping,
> but it cannot remove one: there is no "unmap" in the UI, tRPC or REST API, and a principal
> cannot be deleted while a mapping uses it. Only "Offboard host" removes mappings. Entitlement
> grants cannot be removed either. Scenes **15.4**, **18.3** and **19.2** describe removing a
> mapping; they need that feature (or a different narration). They are marked ⚠.

---

## Episode 11 — Under the hood: what sshd really checks

**Goal:** the viewer knows exactly how sshd uses principals, so every later design choice makes
sense.

### 11.1 — Recap in one picture
**Narration:** In the first series you learned one rule. A login works only when the same
principal is in the user's certificate, and in the server's principals file for the account.
In this series we use that rule to design real access. First, let us see exactly what sshd
does with it.

**Visual:** The two-places picture from episode 05: certificate tag `developers` locks into
the file `/etc/ssh/auth_principals/deploy`. Title card: *Series 2 — Principals in depth*.

### 11.2 — One file per local account
**Narration:** The sshd setting points to a folder, with one file per local account. The
percent u in the path is replaced by the account name in the login. So a login as deploy reads
the deploy file, and a login as root reads the root file. Each account has its own list of
accepted principals.

**Visual:** The drop-in line `AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u`. `%u`
animates into `deploy`, then `root`. Folder view:
```
/etc/ssh/auth_principals/
  deploy   ← developers, sysadmins
  root     ← sysadmins
```

### 11.3 — No file, no certificate login
**Narration:** Here is a useful detail. If an account has no principals file, no certificate
can log in to it. So the accounts you do not map are closed by default. Root stays closed until
you decide who may enter it.

**Visual:** Folder view; account `postgres` has no file. A certificate with `developers` tries
`ssh postgres@dev-01` → red ✕ *no principals file = closed*. Caption: *unmapped accounts stay
closed to certificates*.

### 11.4 — The second line in each file
**Narration:** Each principal appears twice in the file: once alone, and once with the server
name added. The second form is reserved for per-host blocks. Today it changes nothing; it is
there so blocks can work without touching your files again.

**Visual:** The real file:
```
developers
developers@acme-web.example.net
```
Line 2 is grey, with the caption *reserved for per-host blocks (episode 07)*.

### 11.5 — Key ID: who logged in
**Narration:** When sshd accepts a certificate, it writes the certificate's key ID and serial
number in its log. PKI Manager sets the key ID to the person's identity. So every login line
tells you who it was, even when ten people share the deploy account.

**Visual:** Log line types itself:
`Accepted publickey for deploy from 10.0.4.17 port 51022 ssh2: ED25519-CERT SHA256:… ID ana@acme.example (serial 42) CA ECDSA SHA256:…`
`ID ana@acme.example (serial 42)` highlights in orange. *Next: 12 Designing your catalog*.

---

## Episode 12 — Designing your principal catalog

**Goal:** the viewer can design a small, stable catalog of principals.

### 12.1 — Few and durable
**Narration:** The golden rule: principals are a few durable labels. They describe roles, and
roles change rarely. You do the fine slicing per server in the mapping, not by creating more
principals.

**Visual:** Two catalogs side by side. Left (bad): 40 tags like `ana-acme-web`, `pau-dev-03`.
Right (good): 5 tags. The left one fades with a red ✕.

### 12.2 — Three families
**Narration:** Most fleets need three families. Roles, like developers, sysadmins and security.
Scopes, like client acme, which limit someone to one customer. And special principals, like
break glass, for emergencies. A prefix in the name keeps the families apart.

**Visual:** Three columns:
- *Roles*: `developers`, `sysadmins`, `security`
- *Scopes*: `client-acme`, `client-globex`, `client-initech`
- *Special*: `break-glass`

### 12.3 — Naming rules
**Narration:** A principal name starts with a letter or digit, and can contain letters, digits,
dots, dashes, underscores and the at sign, up to sixty-three characters. A colon is not allowed.
Keep names lower case and readable.

**Visual:** Rule `^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$`. Examples: `client-acme` ✓,
`break-glass` ✓, `team.payments` ✓, `u:ana` ✗ *colon not allowed*.

### 12.4 — Do not use people's names
**Narration:** Do not create a principal per person. The certificate already carries the
person, in the key ID. A personal principal in a mapping ties a server to one person, and you
are back to managing lists of people on every server.

**Visual:** Mapping `deploy ← ana, pau, marta, …` grows long → red ✕. Replaced by
`deploy ← developers` → green ✓. Small reminder: *who = Key ID*.

### 12.5 — In PKI Manager
**Narration:** In PKI Manager you create each principal once, in the principal catalog, with a
short description. Principals belong to a zone: the same name in two zones is two different
principals.

**Visual:** Redraw of *Principals → Principal catalog*: rows `developers`, `sysadmins`,
`security`, `client-acme`, `client-globex`, `client-initech`, `break-glass`, each with a
description. Zone switcher shows *prod*. *Next: 13 Mapping a real fleet*.

---

## Episode 13 — Mapping a real fleet

**Goal:** the viewer can turn a fleet into per-class mappings.

### 13.1 — Think in classes
**Narration:** Do not design server by server. Group your servers into classes with the same
risk and the same people. Here we have three: customer production, dev, and internal.

**Visual:** 19 server icons sort themselves into three groups: *Customer production*, *Dev*,
*Internal*.

### 13.2 — Accounts first
**Narration:** Then decide the local accounts. Developers deploy as deploy, or as an app account
on internal servers. Sysadmins use root. Security gets a read-only audit account everywhere. The
accounts must already exist on the servers.

**Visual:** Account cards: `deploy` (app deploys), `appsvc` (internal apps), `root` (admin),
`audit` (read-only). Note: *create them with your normal provisioning*.

### 13.3 — Dev servers
**Narration:** Dev servers are permissive. Developers and sysadmins enter deploy, sysadmins enter
root, and security enters audit.

**Visual:** Table for *Dev*:
| account | accepts |
|---|---|
| deploy | developers, sysadmins |
| root | sysadmins |
| audit | security |

### 13.4 — Internal servers
**Narration:** On internal servers, developers enter the app account, never root. Root stays for
sysadmins, and audit for security.

**Visual:** Table for *Internal*: `appsvc ← developers sysadmins`, `root ← sysadmins`,
`audit ← security`.

### 13.5 — Customer production
**Narration:** On customer production, the deploy account does not accept developers. It accepts
the customer scope. On Acme's servers, that is client acme. Root also accepts break glass, and
audit stays for security.

**Visual:** Table for *Acme production*: `deploy ← client-acme sysadmins`,
`root ← sysadmins break-glass`, `audit ← security`. `client-acme` glows orange.

### 13.6 — Deploying the mappings
**Narration:** You map each principal on each host in PKI Manager. The host turns Stale until its
files are on the server. The Ansible role writes them for you: run it again after you change
mappings. By hand, copy the files and click Mark pushed.

**Visual:** Redraw of the mapping card: *Principal* `client-acme` → *Local account* `deploy` on
`acme-web`. Badge *Stale — needs push* → Ansible play runs → badge disappears.
*Next: 14 People and profiles*.

---

## Episode 14 — People and profiles

**Goal:** the viewer can decide which principals each person carries, with least privilege.

### 14.1 — A junior developer
**Narration:** Ana is a junior developer on the Acme account. Her certificate carries developers
and client acme. She can deploy on dev, on internal app accounts, and on Acme production. Nothing
else.

**Visual:** Ana's certificate: `developers client-acme`. A map of the fleet lights up where she
can log in: dev `deploy`, internal `appsvc`, Acme `deploy`. Everything else stays grey.

### 14.2 — Two customers
**Narration:** Pau works on Acme and Globex, so his certificate carries both scopes. One person,
two scopes, no change on any server.

**Visual:** Pau's certificate: `developers client-acme client-globex`. Acme and Globex production
`deploy` light up. Initech stays grey.

### 14.3 — The sysadmin
**Narration:** Marta is a sysadmin. Her certificate carries only sysadmins. That role is mapped
everywhere, so she needs no customer scope.

**Visual:** Marta's certificate: `sysadmins`. Every `root` and `deploy` lights up.

### 14.4 — Security is not admin
**Narration:** Sara leads security. She carries security, not sysadmins. She can read every
server through the audit account, but she cannot become root. Someone who audits the logs should
not be able to change them. That is separation of duties.

**Visual:** Sara's certificate: `security`. Every `audit` lights up; every `root` shows a lock.
Caption: *audit ≠ admin — separation of duties*.

### 14.5 — Check before you issue
**Narration:** When you issue a certificate, the form shows where each principal grants login
today. Read it before you click: it is the quickest way to catch a principal that gives too much,
or one that is mapped nowhere.

**Visual:** Redraw of *Issue Certificate* with the panel *Where these principals grant login*:
`developers` → dev-01…06 `deploy`, ci `appsvc` …; `client-acme` → acme-web, acme-db, acme-app
`deploy`. *Next: 15 Customer isolation*.

---

## Episode 15 — Customer isolation

**Goal:** the viewer can isolate customers with scopes, and knows when to use zones instead.

### 15.1 — Why scopes work
**Narration:** Scopes give you isolation almost for free. A Globex developer carries developers,
like Ana. But Acme production does not accept developers on deploy. It accepts client acme. So the
Globex developer cannot get in, with a perfectly valid certificate.

**Visual:** A Globex developer's certificate (`developers client-globex`) flies to `acme-web` and
bounces: *no client-acme*. Ana's certificate enters.

### 15.2 — A new customer
**Narration:** A new customer, Umbrella, signs up. Create the principal client umbrella. Map it on
Umbrella's servers. Then issue new certificates, with that scope, only to the people who work on
the account.

**Visual:** Three steps: catalog `client-umbrella` → mapping on `umbrella-web` → Pau's next
certificate gains `client-umbrella`.

### 15.3 — Someone moves to another customer
**Narration:** Ana moves from Acme to Globex. Her next certificate carries client globex instead of
client acme. Certificates last one week, so within a week her Acme access ends by itself. If it
must end now, block her on Acme's servers.

**Visual:** Calendar: this week `developers client-acme`; next issue `developers client-globex`.
Option card: *now → Block user on acme-web, acme-db, acme-app*.

### 15.4 — ⚠ A customer leaves
**Narration:** When a customer leaves, remove its scope from its servers, and stop putting it in
certificates. The certificates that still carry the scope open nothing, because no server accepts
it any more.

**Visual:** `client-initech` mapping rows on `initech-web` and `initech-db` are removed; the hosts
go Stale and are pushed. Certificates carrying `client-initech` show *opens nothing*.
**Depends on the unmap feature (see Product gap).** Today the only way is to offboard the hosts.

### 15.5 — Scopes or zones?
**Narration:** Scopes share one CA. They are perfect inside one team that serves several
customers. If a customer needs a hard boundary, with its own CAs and its own revocation list, use a
zone instead. Zones separate trust; scopes separate access.

**Visual:** Left: one User CA, scopes as coloured tags → *separate access*. Right: two zones,
each with its own CAs → *separate trust*. *Next: 16 Break-glass*.

---

## Episode 16 — Break-glass and temporary access

**Goal:** the viewer can give emergency and temporary access safely.

### 16.1 — The break-glass principal
**Narration:** Break glass is a special principal for emergencies. It is mapped only to root, and
only where you decide. In normal days, nobody carries it.

**Visual:** `root ← sysadmins break-glass` on production; no certificate in the team list carries
`break-glass`. A glass box icon around the tag.

### 16.2 — Breaking the glass
**Narration:** In an incident, you issue one certificate by hand, with break glass and a lifetime of
a few hours. When it expires, the access ends by itself, even if nobody remembers to remove it.

**Visual:** Redraw of *Issue Certificate*: *Principals (roles)* `break-glass`; *Validity (TTL)*
preset `+1h` (or any number of seconds in *Validity in seconds*). A clock runs down to 0; the
certificate turns grey *expired*.

### 16.3 — Leave a trail
**Narration:** PKI Manager writes an audit entry for each certificate it issues, and sshd logs the
key ID of each login. Use both: alert on break glass logins, and review each one after the
incident.

**Visual:** Audit log row `ssh.cert.issue · break-glass · marta@acme.example`; sshd log line with
`ID marta@acme.example (serial 77)`. An alert bell. Checklist: *alert → review → post-mortem*.

### 16.4 — Temporary access for a contractor
**Narration:** The same idea works for a contractor who needs two days on one customer. Create an
identity, issue a certificate with the customer scope and a two-day lifetime. No server changes.
No cleanup.

**Visual:** Identity card `contractor@vendor.example`; certificate `developers client-acme`,
validity *2 days*; calendar ends → *expired, nothing to clean*. *Next: 17 Robots and pipelines*.

---

## Episode 17 — Robots, pipelines and restricted certificates

**Goal:** the viewer can give machines narrow, safe SSH access.

### 17.1 — Robots are identities too
**Narration:** A deploy pipeline or a backup job also needs SSH. Give each robot its own identity
and its own principal, for example deployer. Never reuse a person's certificate in a pipeline.

**Visual:** Two robot icons: *deploy pipeline* (identity `ci@pipeline`, principal `deployer`) and
*backup job* (identity `backup@logs`, principal `backup`).

### 17.2 — Map robots narrowly
**Narration:** Map the robot principal only where the robot works, and only to the account it
needs. Deployer enters deploy on production. It never enters root.

**Visual:** Mapping rows: `deploy ← deployer` on customer production; `root` shows a lock for
`deployer`.

### 17.3 — Lock the command
**Narration:** A certificate can also carry restrictions. A force command means the robot can run
only one command, whatever it asks for. A source address limits where it can connect from.

**Visual:** Issue form fields *Force command (optional)* and *Source address (optional)*, then the
certificate card for the backup job with *Force command*
`/usr/bin/rsync --server --sender -logDtpre.iLsfxC . /var/backups/` and *Source address*
`10.0.8.0/24`. A different command typed by an attacker is replaced by rsync.

### 17.4 — Remove what it does not need
**Narration:** Remove the extensions the robot does not need. A backup job needs no terminal, no
port forwarding, no agent forwarding. In the issue form, one click on Harden clears them all. Fewer
extensions, less damage if the key leaks.

**Visual:** Redraw of the *Extensions* toggles (`permit-X11-forwarding`, `permit-agent-forwarding`,
`permit-port-forwarding`, `permit-pty`, `permit-user-rc`, all on by default) → click *Harden* →
all off.

### 17.5 — Let the pipeline ask for itself
**Narration:** A pipeline can get its own short certificate at the start of each run, through the
sign user operation and a fleet token. The certificate lives for minutes, not weeks.

**Visual:** CI run timeline: *start → POST /api/v1/external/ssh/sign-user (fleet token, ops
`sign-user`) → deploy → certificate expires*. Validity chip *15 min*. *Next: 18 Changes over time*.

---

## Episode 18 — Changes over time, and who did what

**Goal:** the viewer knows which lever to use for each change, and how to audit.

### 18.1 — Change the person, not the servers
**Narration:** When someone changes role, issue their next certificate with the new principals.
Because certificates last one week, the change spreads by itself. You touch no server.

**Visual:** Marta moves from developer to sysadmin: certificate `developers` → next week
`sysadmins`. Servers do not move.

### 18.2 — Change the server, not the people
**Narration:** When you add a server, map the principals for its class and deploy the files. You
touch no certificate. Every person who carries the role can log in at once.

**Visual:** New server `acme-api` drops into *Acme production*; mapping copied from the class;
everyone with `client-acme` can enter `deploy`.

### 18.3 — ⚠ Principals are not revocation
**Narration:** Removing a principal from a mapping, or from the next certificate, does not cut a
login that works today. For that you have two levers: the revocation list, everywhere, or a block,
on one host. Principals decide access going forward; revocation and blocks end it now.

**Visual:** Three levers: *principals → next certificate / next push*, *revoke → everywhere,
≤ 1 pull*, *block → one host, ≤ 1 pull*. **The "remove from a mapping" part depends on the unmap
feature.**

### 18.4 — Limit who may hold a principal
**Narration:** You can also limit which principals each identity may ever receive. Grant the
allowed principals to the identity, and issue with entitlement checks turned on. Then nobody can
give break glass or a customer scope by mistake. Today this is in the API and the Ansible module.

**Visual:** Identity Ana with grants `developers`, `client-acme`. An issue request with
`sysadmins` and `enforceEntitlement: true` → red *identity not entitled to principals: sysadmins*.

### 18.5 — Who did what
**Narration:** For audits, join two logs. PKI Manager records every certificate it issues, with
the principals. sshd records every login, with the key ID and serial. Together they answer: who
had which role, and where did they use it.

**Visual:** Two log panels joined by the serial number `42`: audit row (issued to
`ana@acme.example`, principals `developers client-acme`) ↔ sshd line (`ID ana@acme.example
(serial 42)` on `acme-web`). *Next: 19 Anti-patterns*.

---

## Episode 19 — Anti-patterns and a checklist

**Goal:** the viewer can review an existing design and fix the common mistakes.

### 19.1 — Five mistakes
**Narration:** Five mistakes we see again and again. One: a principal per person. Two: a principal
per server. Three: the security team holding the admin role. Four: robots using a person's
certificate. Five: mappings changed in PKI Manager but never deployed.

**Visual:** Five red cards appear one by one with an icon each.

### 19.2 — ⚠ The fixes
**Narration:** And the fixes. Use roles and scopes, and keep people in the key ID. Slice by server
class in the mapping. Give security its own audit account. Give every robot its own identity and a
restricted certificate. And clear every Stale badge, by running the Ansible role or deploying the
files.

**Visual:** Each red card flips to a green fix card. **(Cleaning up an old per-person design means
removing mappings: depends on the unmap feature.)**

### 19.3 — Your checklist
**Narration:** Before you go live, check four things. Every principal has a clear meaning. Every
account you care about has a principals file, or stays closed on purpose. Every person carries the
fewest principals that let them work. And no host shows Stale.

**Visual:** Checklist with four ticks.

### 19.4 — Close
**Narration:** Principals are just labels. But with a small catalog, mappings by server class, and
short certificates, they give you clear, auditable access across the whole fleet. The companion
page has every table from this series.

**Visual:** The three families, the three server classes, and the two levers (next certificate,
next push) form one picture. End card: companion page.

---

## Corrections to the guide

Facts from the code that differ from [`principals-guide.md`](../../principals-guide.md). The
script follows the code.

1. **`u:<name>` personal principals cannot be created.** Principal names must match
   `^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$` (`backend/src/services/ssh-config.ts`); a colon is
   rejected at catalog creation and at issuance.
2. **A personal principal that is never mapped is never logged as "the principal that
   matched".** sshd logs the certificate **Key ID and serial** on every accepted login
   (`Accepted publickey … CERT … ID <key id> (serial N)`, see `backend/src/crypto/ssh/e2e.test.ts`),
   and PKI Manager sets the Key ID to the identity subject. That is the traceability mechanism.
3. **Mappings cannot be removed** (no unmap; `deletePrincipal` is refused while maps or grants
   reference the principal), and **grants cannot be removed**.
4. **"Derive roles from IdP group membership"** is a process suggestion: PKI Manager does not read
   Keycloak groups when it issues SSH certificates.
5. Each `auth_principals` file has **two lines per principal** (`P` and `P@<fqdn>`), reserved for
   the per-host block issuance gate.

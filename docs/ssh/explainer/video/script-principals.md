# Principals in depth: video script (series 2)

Follow-up series to [`script.md`](script.md) (episodes 01–10). Audience: sysadmins who watched
the first series, or know the basics: User CA, Host CA, the two-places rule. Goal: design,
operate and audit principals in a real fleet, and get the most out of them.

Same conventions as series 1 (one idea per scene, **Narration** read word for word, **Visual**
= what the animation shows, same colour code). Voice: VoiceStudio profile
`dbai24-narrator-vox48` (female, native English). Pace ~150 words per minute.

Sources: [`docs/ssh/principals-guide.md`](../../principals-guide.md), checked against the code
and against OpenSSH, then reviewed independently by two models (Fable and Astra). Where the
code differs from the guide, the script follows the code: see
[Corrections to the guide](#corrections-to-the-guide).

## Running example

Your team runs one fleet for three customers, Acme, Globex and Initech, plus your own servers.
Your own staff use `@ops.example` identities.

| Class | Servers | Why separate |
|---|---|---|
| Customer production | `acme-web`, `acme-db`, `acme-app`, `globex-web`, `globex-db`, `initech-web`, `initech-db` | contractual isolation between customers |
| Dev | `dev-01` … `dev-06` | sandbox, low risk |
| Internal tools | `ci`, `monitor` | shared developer tools |
| Internal sensitive | `vault`, `logs`, `backup`, `db-int` | secrets, logs and backups: admins only |

| Who | Role |
|---|---|
| **Ana** | junior developer, works on Acme |
| **Pau** | senior developer, works on Acme and Globex, on call this week |
| **Marta** | sysadmin |
| **Sara** | security lead |
| **acme-deploy pipeline**, **backup job** | robots |

| # | Episode | Target |
|---|---|---|
| 11 | Under the hood: what sshd really checks | 1:45 |
| 12 | Designing your principal catalog | 1:45 |
| 13 | Mapping a real fleet | 2:00 |
| 14 | People and profiles | 1:45 |
| 15 | Customers: isolation, moves and exits | 2:00 |
| 16 | Break-glass and temporary access | 2:00 |
| 17 | Robots and pipelines | 2:00 |
| 18 | Changing access, and proving who did what | 2:15 |
| 19 | Test your design | 1:45 |

> **Product gaps — fixed.** The five gaps found while writing this series are fixed on branch
> `feat/ssh-principal-gaps` (TASK-245 … TASK-249); the scenes describe the fixed behaviour. Still
> open: the Ansible role does not yet call the new "principals pushed" endpoint (TASK-250), and the web
> issue form does not apply the entitlement check. See [Product gaps](#product-gaps).

---

## Episode 11 — Under the hood: what sshd really checks

**Goal:** the viewer knows exactly how sshd uses principals, so every later design choice makes
sense.

### 11.1 — Where we start
**Narration:** In the first series you learned one rule. A login works only when the same
principal is in the user's certificate, and in the server's principals file for the account. In
this series we use that rule to design real access, for a real fleet.

**Visual:** The two-places picture from episode 05: certificate tag `developers` locks into the
file `/etc/ssh/auth_principals/deploy`. Title card: *Series 2 — Principals in depth*.

### 11.2 — One file per local account
**Narration:** The server looks for the principals in a file named after the account in the login.
A login as deploy reads the deploy file. A login as root reads the root file. So each account has
its own list of accepted principals.

**Visual:** Drop-in line `AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u`; `%u` animates
into `deploy`, then `root`. Folder view:
```
/etc/ssh/auth_principals/
  deploy   developers, sysadmins
  root     sysadmins
```

### 11.3 — No file, no certificate login
**Narration:** In the setup PKI Manager gives you, an account without a principals file accepts no
certificate from your CA. So the accounts you do not map stay closed to certificates. Old keys and
passwords are a separate door: close them too.

**Visual:** Account `postgres` has no file. A certificate with `developers` tries
`ssh postgres@dev-01` → red ✕ *no principals file: certificate refused*. Side card in grey:
*`authorized_keys` and passwords are checked separately → disable them*.

### 11.4 — One match is enough
**Narration:** Each name in the file is a separate way in. The server needs only one name in common
with the certificate. Two names in a file never mean that both are required.

**Visual:** File `deploy` with `client-acme` and `sysadmins`. Certificate A (`client-acme`) ✓,
certificate B (`sysadmins`) ✓, certificate C (`developers`) ✗. Caption: *any one match opens the
account*.

### 11.5 — What the server logs
**Narration:** When the server accepts a certificate, it logs the account, the key ID, the serial
number and the signing CA. The key ID is a label: by default, PKI Manager puts the identity there.
To be sure who it was, match the CA and the serial to the certificate PKI Manager issued.

**Visual:** Log line types itself:
`Accepted publickey for deploy from 10.0.4.17 port 51022 ssh2: ED25519-CERT SHA256:… ID ana@ops.example (serial 42) CA ECDSA SHA256:…`
`ID ana@ops.example` highlights in orange, `(serial 42) CA ECDSA SHA256:…` in navy. An arrow joins
serial + CA to the PKI Manager certificate record. *Next: 12 Designing your catalog*.

---

## Episode 12 — Designing your principal catalog

**Goal:** the viewer can design a small, stable catalog of principals.

### 12.1 — Few and durable
**Narration:** The golden rule: principals are a few durable labels. They describe roles and
customers, and those change rarely. You do the fine slicing per server in the mapping, not by
creating more principals.

**Visual:** Two catalogs side by side. Left (bad): 40 tags like `ana-acme-web`, `pau-dev-03`.
Right (good): 7 tags. The left one fades with a red ✕.

### 12.2 — Three families
**Narration:** Most fleets need three families. Roles, like developers, sysadmins and security.
Customer principals, like client acme, which open one customer's servers. And special principals,
like break glass, for emergencies. A prefix in the name keeps the families apart.

**Visual:** Three columns:
- *Roles*: `developers`, `sysadmins`, `security`
- *Customers*: `client-acme`, `client-globex`, `client-initech`
- *Special*: `break-glass`

### 12.3 — When you need role and customer together
**Narration:** Remember: one match is enough. If an account must require a role and a customer
together, one principal cannot be split in two. Create one principal for the combination, like
acme deployer, and give it only to the people who need both.

**Visual:** File `deploy` with `developers client-acme` → Ana's certificate with only
`client-acme` enters (one match). Replaced by `acme-deployer` alone → only certificates with
`acme-deployer` enter.

### 12.4 — Naming rules
**Narration:** Keep names short, lower case and readable. Letters, digits, dots, dashes and
underscores are fine. A colon is not allowed. And keep the at sign out of your own names: PKI
Manager uses it for the per-host form of a principal.

**Visual:** Rule `^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$`. Examples: `client-acme` ✓, `break-glass` ✓,
`team.payments` ✓, `u:ana` ✗ *colon not allowed*, `developers@acme-web` ⚠ *reserved form*.

### 12.5 — No principals for people
**Narration:** Do not create a principal per person. The certificate already identifies the person.
A personal principal in a mapping ties a server to one person, and you are back to lists of people
on every server.

**Visual:** Mapping `deploy ← ana, pau, marta, …` grows long → red ✕. Replaced by
`deploy ← client-acme` → green ✓.

### 12.6 — In PKI Manager
**Narration:** In PKI Manager you create each principal once, in the principal catalog, with a short
description. Principals belong to a zone: the same name in two zones is two different principals.

**Visual:** Redraw of *Principals → Principal catalog*: rows `developers`, `sysadmins`, `security`,
`client-acme`, `client-globex`, `client-initech`, `break-glass`, each with a description. Zone
switcher shows *prod*. *Next: 13 Mapping a real fleet*.

---

## Episode 13 — Mapping a real fleet

**Goal:** the viewer can turn a fleet into per-class mappings with least privilege.

### 13.1 — Think in classes
**Narration:** Do not design server by server. Group your servers into classes with the same risk
and the same people. Here we have four: customer production, dev, internal tools, and internal
sensitive.

**Visual:** 19 server icons sort themselves into four groups.

### 13.2 — Accounts, and what they may do
**Narration:** Then choose the local accounts. Deploy for releases, an app account for internal
tools, root for administration, and audit for security. A principal only opens an account. What the
person can do inside depends on the account: so make audit read-only, with no sudo.

**Visual:** Account cards: `deploy`, `appsvc`, `root`, `audit`. On `audit`: *read access to logs ·
no sudo · no write on logs*. Note: *create the accounts with your normal provisioning*.

### 13.3 — The mapping per class
**Narration:** Now the mapping. On dev, developers and sysadmins enter deploy. On internal tools,
developers enter the app account. On customer production, deploy accepts only the customer
principal and sysadmins. On the sensitive servers, only sysadmins get in. Root is for sysadmins
everywhere, and audit for security everywhere.

**Visual:** One table, rows appear class by class:
| class | deploy / appsvc | root | audit |
|---|---|---|---|
| Dev | `deploy ← developers sysadmins` | sysadmins | security |
| Internal tools | `appsvc ← developers sysadmins` | sysadmins | security |
| Acme production | `deploy ← client-acme sysadmins` | sysadmins | security |
| Internal sensitive | — | sysadmins | security |

### 13.4 — Deploying the mappings
**Narration:** You map each principal on each host in PKI Manager, and the host turns Stale: its
principals files changed and are not on the server yet. Run the Ansible role, or copy the files by
hand, then click Mark pushed. Automation can also confirm the push itself, with a hash of the files.
To take a principal away, remove the mapping with the cross, and push again.

**Visual:** Redraw of the mapping card: *Principal* `client-acme` → *Local account* `deploy` on
`acme-web`; list *Mappings* with rows `client-acme → deploy`, `sysadmins → root`, each with an ×.
Badge *Stale — needs push* → Ansible play runs → *Mark pushed* → badge disappears. Side card:
`POST /api/v1/external/ssh/hosts/acme-web/principals-pushed {"sha256": "…"}` → *200*. Then × on
`sysadmins → root` → dialog *Remove mapping sysadmins → root?* "This host keeps accepting principal
“sysadmins” for login as “root” until the updated auth_principals files are deployed to it." →
badge back to *Stale — needs push*. *Next: 14 People and profiles*.

---

## Episode 14 — People and profiles

**Goal:** the viewer can decide which principals each person carries, with least privilege.

### 14.1 — A junior developer
**Narration:** Ana is a junior developer on the Acme account. Her certificate carries developers and
client acme. She can deploy on dev, use the internal tools, and deploy on Acme production. Nothing
else.

**Visual:** Ana's certificate: `developers client-acme`. Fleet map lights up: dev `deploy`, internal
tools `appsvc`, Acme `deploy`. Everything else stays grey.

### 14.2 — Two customers
**Narration:** Pau works on Acme and Globex, so his certificate carries both customer principals. One
person, two customers, no change on any server.

**Visual:** Pau's certificate: `developers client-acme client-globex`. Acme and Globex `deploy` light
up. Initech stays grey.

### 14.3 — The sysadmin
**Narration:** Marta is a sysadmin. Her certificate carries only sysadmins, which is mapped
everywhere. She needs no customer principal.

**Visual:** Marta's certificate: `sysadmins`. Every `root` lights up, plus `deploy` on dev and
customers and `appsvc` on internal tools.

### 14.4 — Security is not admin
**Narration:** Sara leads security. She carries security, not sysadmins. She can read every server
through the audit account, but she cannot become root. Someone who audits the logs should not be
able to change them. That is separation of duties.

**Visual:** Sara's certificate: `security`. Every `audit` lights up; every `root` shows a lock.
Caption: *audit ≠ admin: separation of duties*.

### 14.5 — Check before you issue
**Narration:** When you issue a certificate, the form lists where each principal is mapped, in the
identity's zone. Read it before you click. It shows the recorded mappings, not what is installed on
each server, so for anything sensitive, check that the host is not Stale.

**Visual:** Redraw of *Issue User Certificate*, panel *Where these principals grant login*:
`developers` → dev-01 … dev-06 `deploy`, ci `appsvc` …; `client-acme` → acme-web, acme-db, acme-app
`deploy`. Button *Issue Certificate*. *Next: 15 Customers*.

---

## Episode 15 — Customers: isolation, moves and exits

**Goal:** the viewer can isolate customers, move people between them, and end a customer cleanly.

### 15.1 — Isolation for free
**Narration:** Customer principals give you isolation almost for free. A Globex developer carries
developers, like Ana. But Acme's deploy account does not accept developers. So the Globex developer
cannot get in, even with a valid certificate.

**Visual:** A Globex developer's certificate (`developers client-globex`) flies to `acme-web` and
bounces: *no client-acme*. Ana's certificate enters.

### 15.2 — A new customer
**Narration:** A new customer, Umbrella, signs up. Create the principal client umbrella, map it on
Umbrella's servers, and give it, in their next certificate, only to the people who work on that
account.

**Visual:** Three steps: catalog `client-umbrella` → mapping on `umbrella-web` → Pau's next
certificate gains `client-umbrella`.

### 15.3 — Someone moves to another customer
**Narration:** Ana moves from Acme to Globex. Issue her a new certificate with client globex instead
of client acme. Then revoke her old certificate. On the next pull, Acme stops accepting it, and the
new certificate keeps her working.

**Visual:** Old certificate `developers client-acme` (serial 42) → *Revoke* → into the KRL. New
certificate `developers client-globex` (serial 51) stays green. Acme servers refuse serial 42 after
the next pull.

### 15.4 — A customer leaves
**Narration:** When a customer leaves and takes its servers, offboard them in PKI Manager. Offboard
does not touch the machines, so before you hand them over, remove your User CA key and the principals
files on each one, and check that a certificate from your fleet now fails.

**Visual:** Checklist on `initech-web` and `initech-db`: *remove `/etc/ssh/ssh-user-ca.pub` trust and
`auth_principals/*` → test: fleet certificate refused ✓ → Offboard in PKI Manager*. Stop issuing
`client-initech`.

### 15.5 — Customer principals or zones?
**Narration:** Customer principals share one CA, and anyone who can issue in that CA can issue any
customer principal. That is fine inside one team. If a customer must reject everything signed for
other customers, use a separate zone, with its own CAs. A person who works in both zones then needs an
identity and a certificate in each.

**Visual:** Left: one User CA, customer tags → *separate access*. Right: two zones, each with its own
CAs → *separate trust*. Test card: *must Acme reject Globex's CA? → zone*. *Next: 16 Break-glass*.

---

## Episode 16 — Break-glass and temporary access

**Goal:** the viewer can give emergency and temporary access safely.

### 16.1 — Why break-glass
**Narration:** Pau is on call, but he has no root on production. At three in the morning, a database
is stuck and needs root. Break glass is the planned answer: a principal mapped to root, that nobody
carries on a normal day.

**Visual:** Night scene; Pau's certificate `developers client-acme client-globex`; `acme-db` root is
locked. The file `root ← sysadmins break-glass`; `break-glass` in a glass box.

### 16.2 — Breaking the glass
**Narration:** Another person, who can issue certificates, gives Pau one certificate with break glass
and a lifetime of one hour. When it expires, new logins with it fail. Open sessions do not close by
themselves, so end them when the work is done.

**Visual:** Redraw of *Issue User Certificate*: *Principals (roles) \** `break-glass`; *Validity (TTL)*
preset `+1h`. Two people: the issuer (Marta) and the holder (Pau). A clock runs down; the
certificate turns grey *expired*. Small card: *close the session when done*.

### 16.3 — Leave a trail
**Narration:** PKI Manager records every certificate it issues, with its principals and serial. Alert
when a break glass certificate is issued. Then follow its CA and serial in the server logs, which you
send to a central log server, so root on the host cannot change them. Review every use after the
incident.

**Visual:** Audit row `ssh.cert.issue · keyId pau@ops.example · principals break-glass · serial 77` →
alert bell. Central log server receives the sshd line `ID pau@ops.example (serial 77) CA …` from
`acme-db`. Checklist: *alert → follow serial → review*.

### 16.4 — Keep one offline way in
**Narration:** Break glass needs PKI Manager to issue the certificate. Keep one offline way in, for
the day PKI Manager itself is down, and store it like any other emergency secret.

**Visual:** PKI Manager icon with a red ✕; a sealed envelope *offline emergency access* in a safe.

### 16.5 — A contractor for two days
**Narration:** A contractor needs two days of Acme deployment work. Create an identity, and issue one
certificate with client acme only, valid for two days. That opens Acme's deploy account and nothing
else. When the contract ends, offboard the identity, so nobody renews it.

**Visual:** Identity `dev@vendor.example`; certificate `client-acme`, validity *172800 seconds*; fleet
map: only Acme `deploy` lights up. End: *Offboard* → identity disabled. *Next: 17 Robots*.

---

## Episode 17 — Robots and pipelines

**Goal:** the viewer can give machines narrow, safe SSH access.

### 17.1 — Robots are identities too
**Narration:** A deploy pipeline or a backup job also needs SSH. Give each robot its own identity and
its own principal. Never reuse a person's certificate in a pipeline.

**Visual:** Two robot icons: *acme-deploy pipeline* (identity `acme-deploy@ci.ops.example`, principal
`acme-deployer`) and *backup job* (identity `backup@ops.example`, principal `backup`).

### 17.2 — Map robots narrowly
**Narration:** Map each robot principal only where that robot works, and only to the account it needs.
The Acme pipeline enters deploy on Acme's servers, and nowhere else. It never enters root.

**Visual:** Mapping rows: `deploy ← acme-deployer` on `acme-web`, `acme-app`; Globex and root show a
lock for `acme-deployer`.

### 17.3 — Lock the command and the source
**Narration:** A certificate can carry limits. A force command runs one fixed command, whatever the
client asks for. A source address accepts the robot only from the network the server sees it come
from. These limits live in the certificate, so control who can issue that principal.

**Visual:** Issue form fields *Force command (optional)* `/usr/local/bin/run-backup` and *Source
address (optional)* `10.0.8.0/24`. A different command typed by an attacker is replaced by
`run-backup`.

### 17.4 — Remove what it does not need
**Narration:** A backup job needs no terminal, no port forwarding and no agent forwarding. In the issue
form, Harden clears all the extensions with one click. Fewer extensions, less damage if the key leaks.

**Visual:** Redraw of *Extensions* toggles (`permit-X11-forwarding`, `permit-agent-forwarding`,
`permit-port-forwarding`, `permit-pty`, `permit-user-rc`, all on by default) → click
*Harden — clear all* → all off.

### 17.5 — Short certificates for each run
**Narration:** A pipeline can get a fresh certificate for each run, valid for a few minutes. Mint its
token with limits: only the job's principal, and a maximum lifetime of fifteen minutes. A token without
limits can sign any principal in its zone, and PKI Manager marks it Unrestricted. Even with limits, keep
the token in a trusted service, and give the job only the certificate.

**Visual:** Redraw of *Fleet tokens → Mint token* with sign-user ticked: box *sign-user limits*,
*Allowed principals* `acme-deployer` ticked, *Max certificate lifetime* `15 minutes (suggested for CI)`.
Table column *Limits*: `Principals: acme-deployer · Max lifetime: 15 min`; an older token shows the
amber pill *Unrestricted*. Then: trusted service box holds the token → certificate (15 min,
`extensions: []`) goes to the CI job. A request for `root` → red
`403 TOKEN_LIMIT: token "acme-ci" may not sign principal(s) root — allowed: acme-deployer`.
*Next: 18 Changing access*.

---

## Episode 18 — Changing access, and proving who did what

**Goal:** the viewer picks the right lever for each change, and can audit access.

### 18.1 — Certificates do not follow your directory
**Narration:** When someone changes role in your company directory, their SSH certificates do not
change. Your issuing process must request the new principals. Bulk renewal copies the old principals,
so never renew a certificate whose principals are wrong.

**Visual:** Directory card: Ana moves group *acme* → *globex*. Her certificate still shows
`client-acme` until a new one is issued. Bulk renew icon with a warning: *copies old principals*.

### 18.2 — Four levers
**Narration:** There are four levers. A new certificate changes what a person can reach, once the old
one is gone. A mapping change, once deployed, affects the next login, even with old certificates.
Revocation rejects one certificate everywhere. A block rejects one person on one host. None of them
closes a session that is already open.

**Visual:** Four lever cards:
| lever | scope | when |
|---|---|---|
| new certificate | one person | after the old one expires or is revoked |
| mapping change (add or remove) | one server | next login after the files are deployed |
| revoke | one certificate, everywhere | next KRL pull |
| block | one person, one host | next KRL pull |
Footer: *open sessions: close them yourself*.

### 18.3 — Adding a server
**Narration:** When you add a server, map the principals for its class, and deploy the files. Every
certificate that already carries those principals works there at once. You touch no certificate.

**Visual:** New server `acme-api` drops into *Acme production*; mapping copied from the class; Ana's
existing certificate enters `deploy`.

### 18.4 — Limit who may hold a principal
**Narration:** On each identity you can record its allowed principals. A request with the entitlement
check turned on is refused for any other principal. Grants also feed the Access list on each host page,
next to the people who hold a live certificate. The check itself is an option of the API and the
Ansible module; the web form does not apply it.

**Visual:** Redraw of the identity card section *Allowed principals*: `developers`, `client-acme`, each
with remove; select *Add principal…* + *Grant*. API request with `sysadmins` and
`enforceEntitlement: true` → red *identity not entitled to principals: sysadmins*. Then the host
*Access* card: `ana@ops.example · certificate + grant`, `pau@ops.example · certificate`.

### 18.5 — Who did what
**Narration:** For audits, join two records. PKI Manager stores every certificate it issues: identity,
principals, serial and CA. The servers log every login with the CA and serial. Match the two, and you
know who had which role, and where they used it.

**Visual:** Two panels joined by *serial 42 + CA fingerprint*: PKI Manager record (`ana@ops.example`,
`developers client-acme`, serial 42, User CA prod) ↔ central log line (`acme-web: Accepted publickey
for deploy … ID ana@ops.example (serial 42) CA ECDSA SHA256:…`). *Next: 19 Test your design*.

---

## Episode 19 — Test your design

**Goal:** the viewer can prove that the design does what it should, and spot the usual mistakes.

### 19.1 — Test one person end to end
**Narration:** Do not trust a design you have not tested. Take Ana's certificate. Acme deploy must
accept it. Globex deploy must refuse it. Acme root must refuse it. Then find the accepted login in the
logs, and match it to her certificate.

**Visual:** Three terminal attempts: `ssh deploy@acme-web` ✓, `ssh deploy@globex-web` ✗,
`ssh root@acme-web` ✗. Then the log line ↔ certificate record match on serial + CA.

### 19.2 — The usual mistakes
**Narration:** While you test, look for the usual mistakes. A principal per person or per server.
Security with the admin role. A robot with a person's certificate, or a signing token inside a job.
Certificates valid for months. And old authorized keys or passwords still open.

**Visual:** Six red cards appear one by one: *per-person principals*, *security = sysadmins*,
*robot uses a person's cert*, *sign-user token in the job*, *+1y certificates*, *old `authorized_keys`
/ passwords*.

### 19.3 — Close
**Narration:** Principals are just labels. But with a small catalog, mappings by server class, short
certificates, and a tested design, they give you clear and auditable access across the whole fleet.
The principals guide has the full mapping tables.

**Visual:** The three families, the four server classes and the four levers form one picture. End
card: *docs/ssh/principals-guide.md* and the companion page.

---

## Product gaps

Found in the code while writing this series. **All five are fixed on `feat/ssh-principal-gaps`** (one backlog task each); the table keeps the original evidence.

| # | Gap (before the fix) | Evidence | Fix |
|---|---|---|---|
| 1 | No way to remove a principal→account mapping or an entitlement grant (UI, tRPC, REST). `deletePrincipal` is refused while maps or grants exist; only host Offboard deletes maps. | `ssh-principal.service.ts` (no unmap/ungrant), `ssh.routes.ts:344`, `ssh-host.service.ts:417` | TASK-245: unmap + revoke grant (UI ×, tRPC, REST, audit) |
| 2 | Stale does not clear after an Ansible run (the role never calls Mark pushed), and every host-certificate issue or renewal sets `updatedAt`, so the host turns Stale again with no mapping change. | role `tasks/principals.yml`; `ssh-host.service.ts:194-197`; `ssh-principal.service.ts:223-225` | TASK-246: `principals_changed_at`; `POST /external/ssh/hosts/:fqdn/principals-pushed {sha256}`; role follow-up TASK-250 |
| 3 | A `sign-user` fleet token can sign any subject, any principals, any key ID and any lifetime in its zone; it never applies entitlements; default extensions are all five and default lifetime one week. | `ssh-external.routes.ts:50-59,177-197`; `ssh-user.service.ts:171,188-190` | TASK-247: `allowedPrincipals`, `maxValidForSeconds` per token; *Unrestricted* pill |
| 4 | The host Access list ("who can reach this host") joins mappings with **grants**, not with issued certificates; grants have no UI, so the list is empty in normal UI use. (The *Block user…* menu still lists all identities.) | `ssh-block.service.ts:286-299`; `HostAccessCard.tsx:50-51` | TASK-248: Access list also from live certificates (`source`) |
| 5 | The issue-form panel *Where these principals grant login* groups mappings by principal name across all zones. | `ssh-principal.service.ts:96-107` | TASK-249: panel scoped to the identity's zone |

## Corrections to the guide

Facts from the code and OpenSSH that differ from [`principals-guide.md`](../../principals-guide.md).

1. **`u:<name>` personal principals cannot be created.** Names must match
   `^[A-Za-z0-9][A-Za-z0-9._@-]{0,62}$` (`backend/src/services/ssh-config.ts`); a colon is rejected at
   catalog creation and at issuance.
2. **Traceability comes from the Key ID, serial and CA, not from a personal principal.** A principal that
   is never mapped never matches. sshd logs `Accepted publickey … CERT … ID <key id> (serial N) CA …` on
   every accepted login (see `backend/src/crypto/ssh/e2e.test.ts`); PKI Manager sets the Key ID to the
   identity subject by default (callers can override it), and serials are unique per CA.
3. **Principals are additive (OR).** `deploy ← client-acme sysadmins` accepts either one. "Developer AND
   Acme" needs one combined principal.
4. **Revocation by serial is a third lever** next to expiry and blocks (guide lines 152-155): issue the
   new certificate, revoke the old one.
5. **A deployed mapping change affects the next login, even with existing certificates** (guide line
   155 says principals only change on the next issued certificate; that is true only for the
   certificate side).
6. **"Derive roles from IdP group membership"** is a process suggestion: PKI Manager does not read
   identity-provider groups when it issues SSH certificates.
7. Each `auth_principals` file has **two lines per principal** (`P` and `P@<fqdn>`); the second form is
   used by the optional block issuance gate, so keep `@` out of your own principal names.
8. The guide predates the fixes for product gaps 1–5 (unmap, Stale, token limits, Access list, zone-scoped panel).

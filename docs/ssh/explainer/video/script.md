# SSH CA with PKI Manager: video script

Series of short clips. Audience: Linux sysadmins who use SSH every day but have
never used SSH certificates. Voice: VoiceStudio profile `dbai24-narrator-vox48` (female, native English). Pace: ~150 words per minute.

Conventions for every episode:

- One idea per scene. Each scene has the **narration** (read word for word by the
  voice) and the **visual** (what the vector animation shows).
- **Narration is written to be spoken.** Paths, flags and symbols appear only on
  screen; the narration uses a spoken form ("the authorized keys file", "sshd").
  Spoken forms for the voice (e.g. `sshd` → "S S H D") are in [`pronunciation.json`](pronunciation.json); subtitles keep the written form.
- Same running example in all episodes: company **Acme**, servers
  **`web1.acme.example`** and **`db1.acme.example`**, user **Alice**, role
  **`developers`**, local account **`deploy`**, PKI Manager at **`pki.acme.example`**.
- Colour code (oriolrius.me): **orange** = User CA and user certificates,
  **green** = Host CA and host certificates, **navy** = machines (servers, laptops),
  **slate/grey** = files and config, **red** = errors and revocation only.
- On-screen code is real and short. Paths and file contents match what PKI Manager
  renders today (checked against the code, not only the docs).

| # | Episode | Length |
|---|---|---|
| 01 | Why SSH certificates | 1:39 |
| 02 | Two CAs, trust crosses over | 1:06 |
| 03 | Host certificates: no more "fingerprint?" prompt | 1:44 |
| 04 | User certificates: log in with a signed key | 1:29 |
| 05 | Principals: the one rule that matters | 1:38 |
| 06 | Lifecycle: expiry, revocation, rotation | 1:56 |
| 07 | Per-host access blocks | 1:20 |
| 08 | Zones: separate trust domains | 1:05 |
| 09 | Automation: fleet tokens and Ansible | 1:39 |
| 10 | Recap and troubleshooting | 1:28 |

---

## Episode 01 — Why SSH certificates

**Goal:** the viewer understands the two problems of plain SSH keys, and that a
certificate is a public key plus a signed statement about it.

### 01.1 — Hook
**Narration:** You use SSH every day. You copy public keys into the authorized keys file
on each server. And you type "yes" when SSH asks you about a fingerprint. In this series
we replace both habits with SSH certificates, and we manage them with PKI Manager.

**Visual:** A terminal types `ssh deploy@web1.acme.example`. The prompt
"The authenticity of host … can't be established … (yes/no)?" appears. A cursor types
`yes`. Title card: *SSH certificates with PKI Manager — 01 Why*.

### 01.2 — Problem one: key sprawl
**Narration:** Problem one. Every server keeps its own list of trusted keys. Five people and
ten servers already give you fifty lines to maintain. When someone leaves, you must find and
delete their key everywhere. Miss one server, and they still have access.

**Visual:** Grid of 5 people (left) × 10 servers (right). Lines draw from every person to
every server. Counter: *50 keys*. One person turns grey ("left the company"); their lines
fade out one by one, but one line stays, highlighted red.

### 01.3 — Problem two: trust on first use
**Narration:** Problem two goes the other way. The first time you connect, your laptop has no
way to check the server. You say "yes" and hope. When a server is rebuilt, its key changes,
and everybody sees a scary warning. Most people just delete the old line.

**Visual:** Laptop → server arrow with a big "?" on it. Then the
"WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!" banner. A hand deletes a line in
`~/.ssh/known_hosts`.

### 01.4 — The idea: a trusted signer
**Narration:** Certificates fix both problems with one idea. Instead of trusting every key,
you trust one signer: a certificate authority, or CA. The CA puts its signature on keys. Anyone who trusts
the CA trusts every key it signed. You install one line, once.

**Visual:** All the lines from 01.2 collapse into one central CA badge. Each server now has
one short line, "trust CA". The CA badge stamps keys as they pass.

### 01.5 — What is inside a certificate
**Narration:** An SSH certificate is not magic. It is your normal public key, plus a few
fields: who you are, which roles you hold, called principals, and when it is valid. The CA
signs all of it. Change one byte, and the signature breaks.

**Visual:** A public key card. Fields slide in and attach to it: *Key ID: alice*,
*Principals: developers*, *Valid: 7 days*, *Serial*. An orange CA stamp seals the card.
Small caption: `ssh-keygen -L -f id_ed25519-cert.pub` shows these fields.

### 01.6 — Where PKI Manager fits
**Narration:** PKI Manager is that certificate authority. The CA private keys live in a key
management system and never leave it. PKI Manager signs certificates, keeps track of them,
and generates every file your servers and users need. It never logs in to your machines:
you place the files, by hand or with Ansible. Next: the two CAs.

**Visual:** PKI Manager box with a locked vault inside (label: *KMS — CA private keys*).
Arrows out of the box are files (certificate, config, CA public key), not connections into
the servers. End card: *Next: 02 Two CAs*.

---

## Episode 02 — Two CAs, trust crosses over

**Goal:** the viewer can say which CA signs what, and which file goes on which side.

### 02.1 — Two questions in every login
**Narration:** Every SSH login answers two questions. The server asks: is this user really
Alice? And the laptop asks: is this server really web one? Certificates answer both, with two
separate CAs.

**Visual:** Laptop (left) and server (right). Two speech bubbles: from the server "Who are
you?", from the laptop "Who are *you*?".

### 02.2 — The User CA
**Narration:** The User CA puts its signature on people's keys. Servers trust it. On every server you install
the User CA public key, and one sshd setting points to it.

**Visual:** Orange *User CA* badge. An orange arrow goes to the server. Server file appears:
`/etc/ssh/ssh-user-ca.pub` and the line `TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub`.

### 02.3 — The Host CA
**Narration:** The Host CA puts its signature on servers' keys. Clients trust it. On every laptop you add one
line to the known hosts file. It says: trust any server under this domain that the Host CA
signed.

**Visual:** Green *Host CA* badge. A green arrow goes to the laptop. Laptop file appears:
`~/.ssh/known_hosts` with `@cert-authority *.acme.example ecdsa-sha2-nistp256 AAAA…`.
The pattern `*.acme.example` is highlighted.

### 02.4 — Trust crosses over
**Narration:** So trust crosses over. The server holds the User CA key, and the laptop holds
the Host CA key. If you wire only one direction, half of the setup works. Keep this picture in
mind: orange goes to servers, green goes to clients.

**Visual:** Both arrows cross in an X between laptop and server. Summary table fades in:

| You install | Where | So that |
|---|---|---|
| User CA key | every server | servers trust users |
| Host CA line | every client | clients trust servers |

### 02.5 — Creating them
**Narration:** In PKI Manager you create both CAs once, on the SSH page: one of type User, one
of type Host. Their private keys are generated inside the key management system and stay
there. Next: give a server its own certificate.

**Visual:** Vector redraw of *SSH → Certificate Authorities → Create SSH Certificate
Authority*, type *User*, then type *Host*. Two badges appear in the CA list, both *active*.

---

## Episode 03 — Host certificates: no more "fingerprint?" prompt

**Goal:** the viewer can enrol a server by hand and knows every file in the deploy bundle.

### 03.1 — The key stays on the server
**Narration:** Let us enrol web one. One rule for every key in this series: the private key
never leaves its machine. The server already has host keys. You send only the ECDSA public key to
PKI Manager. PKI Manager accepts only that type, and episode six shows why.

**Visual:** Server `web1`. Terminal: `cat /etc/ssh/ssh_host_ecdsa_key.pub`. The private key
file stays inside the server with a lock icon; only the `.pub` card travels to PKI Manager.

### 03.2 — Register and issue
**Narration:** In PKI Manager, under Hosts, register the server: its full name and that public
key. PKI Manager refuses private keys and keys of the wrong type. Then the Host CA signs a
host certificate, valid for one year. The certificate names the server, so clients must
connect with that exact name.

**Visual:** Redraw of *Hosts → Register host*: FQDN `web1.acme.example`, key pasted, checkbox
*Issue a host certificate immediately* on. The key card gets a green Host CA stamp →
*host certificate · principals: web1.acme.example · 52 weeks*.

### 03.3 — The deploy bundle
**Narration:** The host page then shows "Files to place on this server". That one panel is
everything the server needs: the host certificate, both CA public keys, a small sshd
config file, the principals files, and a command that creates the revocation file.

**Visual:** Redraw of the host detail panel. File cards fan out with their paths:
- `/etc/ssh/ssh_host_ecdsa_key-cert.pub` (green)
- `/etc/ssh/ssh-user-ca.pub` (orange)
- `/etc/ssh/ssh-host-ca.pub` (green)
- `/etc/ssh/sshd_config.d/60-ssh-ca.conf` (grey)
- `/etc/ssh/auth_principals/<account>` (grey)
- command: `sudo install -m 0444 /dev/null /etc/ssh/revoked_keys` (grey)

### 03.4 — The config file, line by line
**Narration:** The config file goes in the sshd drop-in folder, and it has five settings.
One: the host key. Two: show this certificate to clients. Three: trust users signed by the
User CA. Four: look up the allowed roles for each account. Five: refuse revoked keys. The
revocation file must exist, even empty. If it is missing, sshd refuses every key login.

**Visual:** The file `60-ssh-ca.conf`; each line highlights as it is read:
```
# Managed by PKI Manager SSH CA (host web1.acme.example)
HostKey /etc/ssh/ssh_host_ecdsa_key
HostCertificate /etc/ssh/ssh_host_ecdsa_key-cert.pub
TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub
AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
RevokedKeys /etc/ssh/revoked_keys
```
Lines 1–2 glow green, line 3 orange, lines 4–5 grey. Footnote: *main `sshd_config` must
contain `Include /etc/ssh/sshd_config.d/*.conf` (default on current distributions)*.

### 03.5 — Test, then reload
**Narration:** Before you reload, give your clients the Host CA line, because this server now
shows only its ECDSA key. Then test the config, and reload, not restart, so open sessions
stay up.

**Visual:** Terminal:
```
sudo install -m 0444 /dev/null /etc/ssh/revoked_keys
sudo sshd -t && sudo systemctl reload ssh     # RHEL: sshd
```
A green check appears.

### 03.6 — The client side
**Narration:** Now the laptop. Add the Host CA line to the known hosts file. PKI Manager
publishes it at a public address. Connect, and there is no question any more: the server shows
its certificate, the laptop checks the green stamp, done. Rebuild the server, sign its new key,
and still no warning. Next: users.

**Visual:** Terminal:
```
curl "https://pki.acme.example/ssh/zones/default/cert-authority?pattern=*.acme.example" \
  >> ~/.ssh/known_hosts
ssh deploy@web1.acme.example
```
The "?" from 01.3 turns into a green check. *Next: 04 User certificates*.

---

## Episode 04 — User certificates: log in with a signed key

**Goal:** the viewer can issue, install and check a user certificate.

### 04.1 — An identity for Alice
**Narration:** Alice needs access. First, in PKI Manager, open User certificates and create a
new identity for her. An identity is a person, or a robot, that can hold certificates.

**Visual:** Redraw of *User certificates → New Identity*: subject `alice@acme.example`.
Identity card "Alice — active".

### 04.2 — Alice keeps her private key
**Narration:** Alice creates a key pair on her own laptop, as usual, and sends only the public
key. Use an Ed25519 or an ECDSA key: PKI Manager does not accept R S A
keys. Her private key never leaves her laptop.

**Visual:** Laptop terminal:
```
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```
Only the `.pub` card travels to PKI Manager.

### 04.3 — Issue the certificate
**Narration:** Now issue a certificate. Choose her identity, paste her public key, and choose
her principals: here, developers. The default lifetime is one week, on purpose: short
lifetimes are the main way access ends. The form also shows on which hosts each principal is
mapped, so you see mistakes before you issue.

**Visual:** Redraw of *Issue Certificate*: identity Alice, key pasted, principal chip
`developers`, validity *7 days*. Side panel: "`developers` → `deploy` on web1". The key card
gets the orange User CA stamp.

### 04.4 — Install it next to the key
**Narration:** Alice saves the certificate next to her private key, with the same name and the
ending "cert dot pub". SSH then sends it automatically. PKI Manager also gives her a ready
block for her SSH config file.

**Visual:** Laptop folder `~/.ssh/`: `id_ed25519`, `id_ed25519.pub`, and the new
`id_ed25519-cert.pub` slides in beside them. Config block:
```
Host *.acme.example
  IdentityFile ~/.ssh/id_ed25519
  CertificateFile ~/.ssh/id_ed25519-cert.pub
  IdentitiesOnly yes
```

### 04.5 — Read it, then log in
**Narration:** Before you log in, read the certificate with ssh-keygen. You see the key ID, the
principals and the validity dates. Then log in. The server does four checks: the key is not
revoked, the signature comes from the User CA, the dates are valid, and a principal matches.
Nobody added a line to the authorized keys file.

**Visual:** Terminal output of `ssh-keygen -L -f ~/.ssh/id_ed25519-cert.pub`, highlighting
`Key ID`, `Valid: from … to …`, `Principals: developers`. Then the login animation: four
check gates on the server — *not revoked*, *signature*, *dates*, *principal* — each turns
green.

### 04.6 — Next week
**Narration:** In a week the certificate expires. Alice asks for a new one, with the same key.
Nothing changes on any server. Next: the fourth check, principals, where most people get stuck.

**Visual:** Calendar flips 7 days; the certificate card fades to grey "expired"; a new card
appears with the same key. Servers do not move. *Next: 05 Principals*.

---

## Episode 05 — Principals: the one rule that matters

**Goal:** the viewer never falls into the "valid certificate, permission denied" trap, and
can design principals for a fleet.

### 05.1 — A principal is a label
**Narration:** A principal is a role label, like developers. On its own it gives nothing. Think
of a Unix group name: it means something only when a server decides to accept it.

**Visual:** A tag `developers` floats alone, grey, with "= no access" under it.

### 05.2 — The two-places rule
**Narration:** Here is the one rule. A login works only when the same principal is in two
places: in the user's certificate, and in a file on the server named after the local account.
Alice logs in as deploy, so the server reads the principals file for deploy. If developers is
in both, she gets in. And the deploy account must already exist on the server.

**Visual:** Left: Alice's certificate with `developers`. Right: server file
`/etc/ssh/auth_principals/deploy`:
```
developers
developers@web1.acme.example
```
(caption on line 2: *per-host form, used by access blocks*). The two `developers` tags slide
together and lock → green. Formula on screen:
`login ⇔ principals(cert) ∩ auth_principals/<account> ≠ ∅`.

### 05.3 — The trap
**Narration:** If the label is in only one place, SSH accepts the signature, and still says
"Permission denied". The certificate is fine. The mapping is missing. This is the most common
mistake.

**Visual:** Same as 05.2 but the server file is empty. Gates *not revoked*, *signature*,
*dates* green; gate *principal* red. Laptop terminal: `Permission denied (publickey).`
Server log (`journalctl -u ssh`):
`error: Certificate does not contain an authorized principal`.

### 05.4 — Mapping in PKI Manager
**Narration:** In PKI Manager you do this on the Principals page. Create the principal once in
the catalog. Then map it, per host, to a local account: developers to deploy on web one. PKI
Manager renders the exact file. The host shows "Stale" until you deploy that file and click
"Mark pushed". Mark pushed only records it: it deploys nothing.

**Visual:** Redraw of *Principals*: catalog entry `developers`; mapping row
`web1 · developers → deploy`. Host badge turns amber *Stale — needs push*; the file is copied
to the server; click *Mark pushed*; badge turns green.

### 05.5 — Two decisions, split
**Narration:** This splits two decisions. The certificate says who you are, and it follows the
person. The mapping says who may enter which account, and it follows the server. Add a server:
you touch no certificate. Hire a person: you touch no server.

**Visual:** Two columns: *Certificate = identity (follows the person)* in orange,
*auth_principals = policy (follows the server)* in grey. A new server drops in on the right
— the certificate column does not move. A new person drops in on the left — the server column
does not move.

### 05.6 — A small fleet design
**Narration:** Keep principals few and stable: roles like developers and sysadmins, plus
customer scopes like client acme. On Acme's production servers, the deploy account accepts
client acme, not developers. So a developer who works for another customer cannot get in, even
with a valid certificate. Next: how access ends.

**Visual:** Three server groups: *dev*, *internal*, *Acme production*. For each, the accepted
principals per account:
- dev: `deploy ← developers sysadmins`, `root ← sysadmins`
- Acme production: `deploy ← client-acme sysadmins`, `root ← sysadmins`
A Globex developer's certificate (`developers client-globex`) bounces off Acme production.
*Next: 06 Lifecycle*.

---

## Episode 06 — Lifecycle: expiry, revocation, rotation

**Goal:** the viewer knows the two tiers of revocation and the routine operations after setup.

### 06.1 — Tier one: expiry
**Narration:** Access ends in two ways. Tier one is expiry. User certificates last one week,
host certificates one year. To remove someone, disable their identity: no new certificates,
and within a week they are out. One warning: sshd still accepts old authorized keys
entries, so remove those first.

**Visual:** Timeline bar of 7 days with the certificate fading out at the end. Label
*Tier 1 — short lifetime (primary)*. Redraw of *Disable identity?* dialog. Small warning
card: *old `authorized_keys` entries still work → remove them*.

### 06.2 — Tier two: the revocation list
**Narration:** Tier two is the emergency stop: the key revocation list, or KRL. Revoke a
certificate in PKI Manager, and it goes on the list. sshd reads that file on every login, so
no reload is needed once the new file is in place.

**Visual:** Red *KRL* list. A certificate card is dropped into it. Arrow to the server file
`/etc/ssh/revoked_keys` (setting `RevokedKeys`). Gate *not revoked* turns red for that card.

### 06.3 — Getting the list to the servers
**Narration:** PKI Manager does not push. Each server pulls. The recommended way is the KRL
client. About every fifteen minutes it asks for the list. The list arrives encrypted to the
server's own ECDSA key, which is why hosts use that key type. The client checks the Host
CA signature, and only then installs the file. A simpler cron download exists, but it has no
signature check and no per-host blocks.

**Visual:** Server with a clock icon "~15 min". Envelope with a lock arrives (label:
*encrypted to this host's ECDSA key*), green signature check against
`/etc/ssh/ssh-host-ca.pub`, then the file is installed. Small grey secondary path:
*cron + curl `/krl/<userCaId>.bin` — no signature, no blocks*.

### 06.4 — When someone leaves, when a server goes
**Narration:** When someone leaves, click Offboard on their identity. One action revokes all their
active certificates and disables the identity, and it cannot be undone. Disable alone only stops new
certificates. When you decommission a server, use Offboard on the host page. It is final: it removes
the mappings and the host gets no more certificates. Also destroy the server's host key, because
laptops do not check the revocation list.

**Visual:** Redraw of the *User certificates* identity card for Alice with buttons *Issue*,
*Disable*, *Offboard*. Click *Offboard* → dialog *Offboard alice@acme.example?*: "This revokes
**2 active certificates** of **alice@acme.example** and **disables the identity**", bullets
(KRL, no new certificates, cannot be undone), reason "left the company", red *Offboard* button.
Her two certificate cards fall into the KRL → identity turns grey *disabled*. Then server card
`old-db` → *Offboard* → mapping rows vanish, host badge *offboarded*; a shredder icon on the host key.

### 06.5 — Rotating a CA
**Narration:** CA keys can rotate too. When you rotate a CA, the old one becomes "rotating": it is
still trusted, but new certificates come from the new CA at once. So first deploy the new trust
files, which list both keys. When all old certificates have expired, retire the old CA.

**Visual:** Two orange badges side by side: *old — rotating* and *new — active*. The trust
file on a server lists both keys. A server without the new file rejects a new certificate (red).
Calendar runs; old certificates expire; old badge → *retired*.

### 06.6 — Clocks
**Narration:** All of this depends on time. Run NTP or chrony on every server and every laptop.
A wrong clock makes a valid certificate look expired, or an expired one look valid. Next:
blocking one person on one server.

**Visual:** A clock out of sync; a certificate flickers between valid and expired.
`timedatectl` shows `System clock synchronized: yes`. *Next: 07 Per-host blocks*.

---

## Episode 07 — Per-host access blocks

**Goal:** the viewer knows the difference between a block and a revocation, and how a block
reaches the host.

### 07.1 — A narrower tool
**Narration:** Sometimes revocation is too much. Alice must not reach the database server today,
but she still needs every other server. Revoking her certificate cuts her off everywhere. A
block cuts her off on one host only.

**Visual:** Alice connected to 5 servers. *Revoke*: all 5 lines turn red. *Block on db1*: only
the db1 line turns red.

### 07.2 — How it works
**Narration:** Each host gets its own revocation list. It holds the normal revocations, plus the
keys of everyone blocked on that host. Alice's certificate stays valid; only the database
server refuses it. A block works on keys, so if two identities share one key, both are blocked.
PKI Manager warns you.

**Visual:** Formula assembles from blocks:
`KRL(db1) = host-CA revocations ∪ user-CA revocations ∪ blocks on db1`.
Only db1's list has Alice's key.

### 07.3 — In PKI Manager
**Narration:** On the host page you see who can reach that host, and through which principal.
Choose "Block user", pick Alice, add a reason, confirm. It is one audited action, and you can
undo it with Unblock.

**Visual:** Redraw of the host *Access* card: row *Alice · developers → deploy*. Menu
*Block user…* → Alice → reason "incident 42" → confirm. Row shows a red *Blocked* pill.

### 07.4 — When it takes effect
**Narration:** The block lands on the host's next pull, so in about fifteen minutes. The KRL
page shows the state of each host: "Rolling out", then "Enforced" when the host has downloaded
the new list. This needs the KRL client. A host without it stays at "Rolling out", and the
block never lands there.

**Visual:** State pill animates *Rolling out → Enforced*. Tooltip: *served to the host's
puller at 10:42*. A second host without krl-client stays amber *Rolling out*, with a clock
that never completes.

### 07.5 — Limits to know
**Narration:** Two limits. First, the delay of one pull. Second, if Alice can still get new
certificates, she could try a new key inside that window. To close that gap, turn on the
optional issuance gate: new certificates then cannot open the blocked host. Next: zones.

**Visual:** Timeline with a small gap labelled *≤ 1 pull interval*. Note card:
*Optional: `SSH_BLOCK_ISSUANCE_GATE`*. *Next: 08 Zones*.

---

## Episode 08 — Zones: separate trust domains

**Goal:** the viewer knows when to use zones and the one rule of zones.

### 08.1 — One CA pair is one trust domain
**Narration:** So far we had one User CA and one Host CA. That is one trust domain. But what if
production and staging must never trust each other? Or customer A and customer B?

**Visual:** One big box with both CAs, all servers and all users inside.

### 08.2 — Zones
**Narration:** Use zones. A zone is a real trust boundary, not a label. Each zone has its own
User CA, its own Host CA, and its own hosts, users and principals.

**Visual:** The box splits into two: *prod* and *staging*, each with an orange and a green
badge, its own servers and users.

### 08.3 — The rule
**Narration:** The one rule: a host in a zone trusts only that zone's User CA. A staging
certificate never opens a production server. Revocations and blocks also stay inside their zone.

**Visual:** A staging certificate (orange, *staging* tag) flies to a prod server and bounces off.
A prod certificate enters.

### 08.4 — Practical rules
**Narration:** Names are unique per zone, so web one can exist in both. A person who needs both
zones gets two identities. A host cannot move to another zone: offboard it and enrol it again.
And you archive a zone; you do not delete it.

**Visual:** Four short cards: *same FQDN in two zones ✓*, *one person = one identity per zone*,
*zone is fixed → offboard + re-enrol*, *archive, don't delete*.

### 08.5 — No guessing
**Narration:** With one zone, nothing changes, and you can ignore zones. When a second zone
exists, every request must say which zone it means. If it does not, PKI Manager refuses,
instead of signing with the wrong CA. Fleet tokens already carry their zone. In the web UI, use
the zone switcher. Next: automation.

**Visual:** A request without zone → red error:
`zone is ambiguous — 2 zones exist (prod, staging); specify one explicitly`.
Redraw of the zone switcher in the SSH header. *Next: 09 Automation*.

---

## Episode 09 — Automation: fleet tokens and Ansible

**Goal:** the viewer can enrol a fleet with Ansible and knows what a fleet token can do.

### 09.1 — Manual does not scale
**Narration:** Copying files by hand is fine for one server. For a fleet, let the servers enrol
themselves, with a fleet token and the Ansible role.

**Visual:** One server with files dragged by hand → then 20 servers; a playbook icon handles all
of them.

### 09.2 — Fleet tokens
**Narration:** A fleet token is a secret string for the automation API. It works in one zone, with
its CAs, and only for a list of operations. Mint it on the Fleet tokens page, or with the Ansible
module. Pick a preset, for example a self-provisioning host with KRL. PKI Manager shows the token
only once and stores only a hash. Keep it in Ansible Vault.

**Visual:** Redraw of *SSH → Fleet tokens → Mint token*: name `acme-fleet`, preset
*Self-provisioning host with KRL (recommended)* ticks `sign-host`, `get-principals`,
`register-host-pubkey`; Host CA preselected, User CA *Not needed*. Click *Mint token* → amber panel
*Token "acme-fleet" created. Copy it now.* with `pkimg_…` and *Copy*; warning "You will not see
this token again." The token drops into a vault icon. Small caption: also `ssh_token_mint` in the
Ansible module.

### 09.3 — The Ansible role
**Narration:** Install the PKI Manager Ansible collection and apply its ssh host cert role. One
run does it all. It uses the host key, or creates one, and gets it signed. It installs both CA
public keys, writes the principals files and the sshd config, tests and reloads sshd, and
sets up automatic renewal.

**Visual:**
```yaml
- hosts: sshservers
  become: true
  vars:
    ssh_ca_base_url: https://pki.acme.example
    ssh_ca_fleet_token: "{{ vault_fleet_token }}"
  roles:
    - oriolrius.pki_manager.ssh_host_cert
```
Four phase boxes light up in order: *key + cert + CA keys*, *principals*, *sshd config*,
*renewal*.

### 09.4 — Turn on revocation
**Narration:** By default the role installs an empty revocation list. To get live revocation and
blocks, turn on the encrypted KRL channel. The role then registers the host for encrypted
delivery and installs the KRL client. The PKI Manager server needs this channel enabled too.

**Visual:**
```yaml
    ssh_host_cert_ecies_enabled: true          # encrypted KRL channel
    ssh_host_cert_krl_client_url: https://artifacts.acme.example/krl-client-linux-amd64
    ssh_host_cert_krl_client_checksum: "sha256:…"
```
Note card: *backend: `SSH_ECIES_ENABLED=true`*. A `krl-client` icon with a 15-minute clock is
added to each server.

### 09.5 — Order matters
**Narration:** One ordering trap. The role writes the principals files from the mappings that
exist when it runs. On a new host: run the role, create the mappings, then run it again. Or
register the host in PKI Manager first.

**Visual:** Two timelines. Wrong: *role run → mappings created → login denied*. Right:
*role run → mappings → role run again → login OK*.

### 09.6 — Robots and CI
**Narration:** Pipelines can get user certificates too, through the sign user operation. You can
lock such a certificate to one command and to source addresses. One more risk: the renewal job
keeps the token on the host. If that is too much, turn renewal off and renew from the controller.
Next: the recap.

**Visual:** CI icon → `POST /api/v1/external/ssh/sign-user` → certificate with
*force-command: /usr/bin/rsync …* and *source-address: 10.0.0.0/8*. Warning card: *renewal
stores the token in `/etc/pki-manager/ssh-renew.env` (0600) — `ssh_host_cert_renew_enabled:
false` to avoid it*. *Next: 10 Recap*.

---

## Episode 10 — Recap and troubleshooting

**Goal:** the viewer leaves with the setup order and a checklist for the common failures.

### 10.1 — The order
**Narration:** Here is the whole setup in six steps. One: create the User CA and the Host CA. Two:
hand out trust, with the User CA going to the servers and the Host CA to the laptops. Three: enrol each host. Four: create
principals and map them to accounts. Five: issue user certificates with matching principals. Six:
end access with short lifetimes, or with the revocation list when it is urgent.

**Visual:** Six numbered steps build a staircase; each step shows the colour of its piece.

### 10.2 — Still asked about the fingerprint
**Narration:** Now the common failures. SSH still asks about the fingerprint? Your laptop does not
trust the Host CA. Check the CA line in known hosts, and that its pattern matches the server name.
Also connect with the exact name that is in the host certificate, not an IP address or a short
name.

**Visual:** Symptom card + fix card; pattern `*.acme.example` vs `web1.acme.example` ✓,
`ssh deploy@10.0.0.5` ✗, `ssh deploy@web1` ✗.

### 10.3 — Permission denied with a valid certificate
**Narration:** "Permission denied", but the certificate looks fine? It is almost always the
principal. Compare the principals in the certificate with the server's principals file for that
account. And check that the host is not "Stale".

**Visual:** Side by side: `ssh-keygen -L` → `Principals: developers` vs
`/etc/ssh/auth_principals/deploy` (empty) → red.

### 10.4 — Other quick checks
**Narration:** Every key login fails, for every user? The revocation file is missing or
unreadable. Certificate expired too early, or not valid yet? Check the clocks. For anything else,
run SSH in verbose mode on the laptop, and read the sshd log on the server. They tell you
which check failed.

**Visual:** Three cards: *all key logins denied → `/etc/ssh/revoked_keys` missing*,
*time errors → NTP*, *debug → `ssh -v` + `journalctl -u ssh` (RHEL: `-u sshd`)*.

### 10.5 — Close
**Narration:** One CA instead of hundreds of keys. Short lifetimes instead of cleanup. And PKI
Manager to sign, track, and generate every file. The companion page has every diagram and every
command from this series.

**Visual:** The CA badge from episode 01, the crossing arrows from 02, the four gates from 04.
End card: the companion page `docs/ssh/explainer/index.html`.

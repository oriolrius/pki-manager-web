// Build YouTube metadata (title, description with chapters, tags) for every episode.
// Usage: node youtube/metadata.mjs  -> youtube/metadata.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = join(HERE, '..');
const REPO = 'https://github.com/oriolrius/pki-manager-web';
const DOCS = `${REPO}/tree/main/docs/ssh/explainer`;

// One short summary per episode (plain text, first lines of the description).
const SUMMARY = {
  '01': 'Plain SSH keys do not scale, and "trust on first use" trusts nothing. An SSH certificate authority fixes both: every server and every laptop trusts one signer instead of every key. See what is inside a certificate and where PKI Manager fits.',
  '02': 'Every SSH login answers two questions: "is this the right server?" and "is this the right person?". So there are two CAs, a Host CA and a User CA, and their trust crosses over: the User CA key goes to the servers, the Host CA line goes to the laptops.',
  '03': 'Enrol a server by hand: register its ECDSA P-256 host key in PKI Manager, place the deploy bundle (host certificate, User CA key, principals files, KRL, sshd drop-in) and reload sshd. The "fingerprint? yes/no" prompt is gone.',
  '04': 'Create an identity, issue a one-week user certificate for a public key, install it next to the key and log in. Then read the certificate with ssh-keygen -L and see the four checks sshd makes.',
  '05': 'A principal is a role label, and it gives access only when it is in two places: in the user certificate and in /etc/ssh/auth_principals/ACCOUNT on the server. Learn the one rule that ends the "valid certificate, permission denied" trap.',
  '06': 'Short certificate lifetimes first, the KRL (key revocation list) for emergencies. Expiry, revoking a certificate or a whole identity, offboarding, and how to rotate a CA without locking anyone out.',
  '07': 'Cut one person off one server and keep their access everywhere else. A per-host block is not a revocation: see how it reaches the server, what Stale and Mark pushed mean, and how to undo it.',
  '08': 'Production and staging, or customer A and customer B, in one PKI Manager with a real boundary. A host in a zone trusts only the User CA of its own zone.',
  '09': 'Let servers enrol themselves: mint a scoped fleet token and run the Ansible role. What each token permission does, why to keep tokens narrow, and how to rotate and revoke them.',
  '10': 'The setup order in one picture, then a checklist for the common failures: the fingerprint prompt still shows, permission denied with a valid certificate, every key login refused, and more. Read the sshd log line to find the cause.',
  '11': 'Under the hood of a certificate login: one principals file per local account, an account with no file accepts no certificate, one matching principal is enough (OR, never AND), and the sshd log line that tells you who logged in (key ID, serial and CA).',
  '12': 'Design a principal catalog that lasts: few durable role labels, customer and special principals, robot principals, naming rules, and a combined principal when you need "role and customer" together. No principal per person: the key ID already identifies the person.',
  '13': 'Map principals to a real fleet by server class: customer production, development, internal tools and sensitive internal servers, plus a read-only audit account. Push the principals files, see Stale until the push is confirmed, and remove mappings safely.',
  '14': 'People and profiles: least privilege per person, separation of duties (security is not admin), and how to check what a person can reach before you issue a certificate.',
  '15': 'Customers: keep them isolated, move a person between customers (issue the new certificate, then revoke the old one by serial), handle a customer that leaves, and know when to use zones instead of principals.',
  '16': 'Break-glass and temporary access: a break-glass principal mapped to root that nobody carries on normal days, issuer is not holder, a one-hour certificate, alerts on use, an offline way in, and short certificates for contractors.',
  '17': 'Robots and CI/CD pipelines: one identity and one principal per robot, mapped narrowly. Force command, source address and "Harden" extensions, plus fleet tokens with allowed principals and a maximum certificate lifetime.',
  '18': 'Changing access and proving who did what: the four levers (mapping, certificate, block, revocation), what each changes and when, and how to match the CA and serial in the sshd log with the PKI Manager audit log.',
  '19': 'Test your access design end to end: one accepted login and two refused ones for one person, then match the log line to the certificate. A short checklist before you roll the design out.',
};
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const slug = (s) => s.toLowerCase().replace(/["“”?:,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const BASE_TAGS = ['SSH', 'SSH certificates', 'SSH CA', 'OpenSSH', 'ssh-keygen', 'certificate authority', 'Linux', 'sysadmin', 'PKI', 'PKI Manager', 'DevOps', 'security'];
const EP_TAGS = {
  '01': ['authorized_keys', 'trust on first use', 'known_hosts'],
  '02': ['user CA', 'host CA', 'TrustedUserCAKeys', '@cert-authority'],
  '03': ['host certificate', 'sshd_config', 'HostCertificate'],
  '04': ['user certificate', 'ssh login', 'ssh-keygen -L'],
  '05': ['principals', 'AuthorizedPrincipalsFile', 'permission denied'],
  '06': ['revocation', 'KRL', 'RevokedKeys', 'CA rotation'],
  '07': ['access control', 'block user', 'per-host access'],
  '08': ['multi-tenant', 'zones', 'trust domains'],
  '09': ['Ansible', 'automation', 'fleet', 'API token'],
  '10': ['troubleshooting', 'checklist', 'sshd logs'],
  '11': ['principals', 'AuthorizedPrincipalsFile', 'sshd'],
  '12': ['principals', 'naming convention', 'RBAC'],
  '13': ['principals', 'server fleet', 'access mapping'],
  '14': ['least privilege', 'RBAC', 'access profiles'],
  '15': ['multi-tenant', 'customer isolation', 'offboarding'],
  '16': ['break-glass', 'emergency access', 'contractors'],
  '17': ['CI/CD', 'deploy keys', 'force-command', 'service accounts'],
  '18': ['access review', 'audit', 'revocation'],
  '19': ['testing', 'access design', 'checklist'],
};

const eps = readdirSync(join(VIDEO, 'build')).filter((d) => /^ep\d\d$/.test(d)).map((d) => d.slice(2)).sort();
const out = [];
for (const ep of eps) {
  const tl = JSON.parse(readFileSync(join(VIDEO, 'build', `ep${ep}`, 'timeline.json'), 'utf8'));
  const s2 = Number(ep) >= 11;
  const series = s2 ? 'Series 2 · Principals in depth' : 'Series 1 · SSH certificates from zero';
  const title = `${tl.title} | SSH Certificates #${ep}`;
  if (title.length > 100) throw new Error(`title too long: ${title}`);
  // YouTube shows chapters only when each one is at least 10 s: fold a short scene into the one before.
  const chapters = [];
  tl.scenes.forEach((s, i) => {
    if (i && s.end - s.start < 10) chapters[chapters.length - 1] += ` · ${s.title}`;
    else chapters.push(`${mmss(i ? s.start : 0)} ${s.title}`);
  });
  const short = tl.scenes.filter((s) => s.end - s.start < 10).map((s) => s.id);
  const description = [
    SUMMARY[ep],
    '',
    `Episode ${ep} of "SSH certificates with PKI Manager" (${series}). A short series for Linux sysadmins who know SSH but have never used an SSH certificate authority.`,
    '',
    'Chapters',
    ...chapters,
    '',
    `Companion page, diagrams and scripts: ${DOCS}`,
    `PKI Manager (open source): ${REPO}`,
    'Playlist: {{PLAYLIST_URL}}',
    '',
    'Narration: synthetic voice. English subtitles included.',
    '',
    '#SSH #OpenSSH #Linux',
  ].join('\n');
  const tags = [...new Set([...BASE_TAGS, ...(EP_TAGS[ep] ?? [])])];
  if (tags.join(',').length > 480) throw new Error(`tags too long ep${ep}`);
  out.push({
    episode: ep,
    file: `media/ssh-ca-${ep}-${slug(tl.title)}.mp4`,
    captions: `media/ssh-ca-${ep}-${slug(tl.title)}.srt`,
    duration: Math.round(tl.duration * 10) / 10,
    title, description, tags,
    categoryId: '28', // Science & Technology
    defaultLanguage: 'en', defaultAudioLanguage: 'en',
    privacyStatus: 'private', madeForKids: false, license: 'youtube', embeddable: true,
    containsSyntheticMedia: true,
    shortChapters: short,
  });
}
writeFileSync(join(HERE, 'metadata.json'), JSON.stringify({
  playlist: {
    title: 'SSH Certificates with PKI Manager',
    description: 'A short video series for Linux sysadmins: SSH certificate authorities from zero (episodes 1-10), then principals in depth with real-world access designs (episodes 11-19). Host and user certificates, principals, revocation (KRL), per-host blocks, zones, Ansible automation, break-glass access and CI robots, all with the open-source PKI Manager.\n\n' + `Companion page and diagrams: ${DOCS}\nSource: ${REPO}`,
    privacyStatus: 'private', defaultLanguage: 'en',
  },
  videos: out,
}, null, 2));
console.log(out.map((v) => `${v.episode} ${v.title.length}c ${v.tags.join(',').length}t short:${v.shortChapters.join(' ') || '-'}  ${v.title}`).join('\n'));

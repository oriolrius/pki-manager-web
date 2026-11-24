// Build YouTube metadata (title, description with chapters, tags) for every episode.
// Usage: node youtube/metadata.mjs  -> youtube/metadata.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = join(HERE, '..');
const REPO = 'https://github.com/oriolrius/pki-manager-web';
const DOCS = 'https://oriolrius.github.io/pki-manager-web/ssh/videos/';
// Blog post of each episode (oriolrius.blog, published 2026-11-24 with September dates), per language.
const BLOG = {
  '01': {
    'en': 'https://oriolrius.blog/en/2026/09/03/ssh-certificates-01-why/',
    'es': 'https://oriolrius.blog/es/2026/09/03/certificados-ssh-01-por-que-los-certificados-ssh/',
    'ca': 'https://oriolrius.blog/ca/2026/09/03/certificats-ssh-01-per-que-els-certificats-ssh/'
  },
  '02': {
    'en': 'https://oriolrius.blog/en/2026/09/04/ssh-certificates-02-two-cas/',
    'es': 'https://oriolrius.blog/es/2026/09/04/certificados-ssh-02-dos-cas-la-confianza-se-cruza/',
    'ca': 'https://oriolrius.blog/ca/2026/09/04/certificats-ssh-02-dues-cas-la-confianca-es-creua/'
  },
  '03': {
    'en': 'https://oriolrius.blog/en/2026/09/05/ssh-certificates-03-host-certificates/',
    'es': 'https://oriolrius.blog/es/2026/09/05/certificados-ssh-03-certificados-de-host-el-aviso-de-huella-digital-ya-no-aparece/',
    'ca': 'https://oriolrius.blog/ca/2026/09/05/certificats-ssh-03-certificats-d-amfitrio-no-mes-pregunta-del-fingerprint/'
  },
  '04': {
    'en': 'https://oriolrius.blog/en/2026/09/06/ssh-certificates-04-user-certificates/',
    'es': 'https://oriolrius.blog/es/2026/09/06/certificados-ssh-04-certificados-de-usuario-iniciar-sesion-con-una-clave-firmada/',
    'ca': 'https://oriolrius.blog/ca/2026/09/06/certificats-ssh-04-certificats-d-usuari-iniciar-sessio-amb-una-clau-signada/'
  },
  '05': {
    'en': 'https://oriolrius.blog/en/2026/09/08/ssh-certificates-05-principals/',
    'es': 'https://oriolrius.blog/es/2026/09/08/certificados-ssh-05-principales-la-unica-regla-que-importa/',
    'ca': 'https://oriolrius.blog/ca/2026/09/08/certificats-ssh-05-principals-l-unica-regla-que-importa/'
  },
  '06': {
    'en': 'https://oriolrius.blog/en/2026/09/09/ssh-certificates-06-lifecycle/',
    'es': 'https://oriolrius.blog/es/2026/09/09/certificados-ssh-06-caducidad-revocacion-y-rotacion/',
    'ca': 'https://oriolrius.blog/ca/2026/09/09/certificats-ssh-06-caducitat-revocacio-i-rotacio/'
  },
  '07': {
    'en': 'https://oriolrius.blog/en/2026/09/10/ssh-certificates-07-per-host-blocks/',
    'es': 'https://oriolrius.blog/es/2026/09/10/certificados-ssh-07-bloqueos-de-acceso-por-host/',
    'ca': 'https://oriolrius.blog/ca/2026/09/10/certificats-ssh-07-bloquejos-d-acces-per-servidor/'
  },
  '08': {
    'en': 'https://oriolrius.blog/en/2026/09/11/ssh-certificates-08-zones/',
    'es': 'https://oriolrius.blog/es/2026/09/11/certificados-ssh-08-zonas-dominios-de-confianza-separados/',
    'ca': 'https://oriolrius.blog/ca/2026/09/11/certificats-ssh-08-zones-dominis-de-confianca-separats/'
  },
  '09': {
    'en': 'https://oriolrius.blog/en/2026/09/12/ssh-certificates-09-automation/',
    'es': 'https://oriolrius.blog/es/2026/09/12/certificados-ssh-09-tokens-de-flota-y-ansible/',
    'ca': 'https://oriolrius.blog/ca/2026/09/12/certificats-ssh-09-tokens-de-flota-i-ansible/'
  },
  '10': {
    'en': 'https://oriolrius.blog/en/2026/09/13/ssh-certificates-10-troubleshooting/',
    'es': 'https://oriolrius.blog/es/2026/09/13/certificados-ssh-10-resumen-y-resolucion-de-problemas/',
    'ca': 'https://oriolrius.blog/ca/2026/09/13/certificats-ssh-10-resum-i-resolucio-de-problemes/'
  },
  '11': {
    'en': 'https://oriolrius.blog/en/2026/09/18/ssh-principals-11-what-sshd-checks/',
    'es': 'https://oriolrius.blog/es/2026/09/18/certificados-ssh-11-por-dentro-que-comprueba-realmente-sshd/',
    'ca': 'https://oriolrius.blog/ca/2026/09/18/certificats-ssh-11-sota-el-capo-que-comprova-realment-sshd/'
  },
  '12': {
    'en': 'https://oriolrius.blog/en/2026/09/19/ssh-principals-12-catalog/',
    'es': 'https://oriolrius.blog/es/2026/09/19/certificados-ssh-12-disenando-tu-catalogo-de-principales/',
    'ca': 'https://oriolrius.blog/ca/2026/09/19/certificats-ssh-12-dissenyant-el-vostre-cataleg-de-principals/'
  },
  '13': {
    'en': 'https://oriolrius.blog/en/2026/09/20/ssh-principals-13-mapping-a-fleet/',
    'es': 'https://oriolrius.blog/es/2026/09/20/certificados-ssh-13-mapear-una-flota-real/',
    'ca': 'https://oriolrius.blog/ca/2026/09/20/certificats-ssh-13-mapatge-d-una-flota-real/'
  },
  '14': {
    'en': 'https://oriolrius.blog/en/2026/09/22/ssh-principals-14-people-profiles/',
    'es': 'https://oriolrius.blog/es/2026/09/22/certificados-ssh-14-personas-y-perfiles/',
    'ca': 'https://oriolrius.blog/ca/2026/09/22/certificats-ssh-14-persones-i-perfils/'
  },
  '15': {
    'en': 'https://oriolrius.blog/en/2026/09/23/ssh-principals-15-customers/',
    'es': 'https://oriolrius.blog/es/2026/09/23/certificados-ssh-15-clientes-aislamiento-traslados-y-bajas/',
    'ca': 'https://oriolrius.blog/ca/2026/09/23/certificats-ssh-15-clients-aillament-trasllats-i-sortides/'
  },
  '16': {
    'en': 'https://oriolrius.blog/en/2026/09/24/ssh-principals-16-break-glass/',
    'es': 'https://oriolrius.blog/es/2026/09/24/certificados-ssh-16-acceso-break-glass-y-acceso-temporal/',
    'ca': 'https://oriolrius.blog/ca/2026/09/24/certificats-ssh-16-break-glass-i-acces-temporal/'
  },
  '17': {
    'en': 'https://oriolrius.blog/en/2026/09/25/ssh-principals-17-robots-pipelines/',
    'es': 'https://oriolrius.blog/es/2026/09/25/certificados-ssh-17-robots-y-pipelines/',
    'ca': 'https://oriolrius.blog/ca/2026/09/25/certificats-ssh-17-robots-i-pipelines/'
  },
  '18': {
    'en': 'https://oriolrius.blog/en/2026/09/26/ssh-principals-18-who-did-what/',
    'es': 'https://oriolrius.blog/es/2026/09/26/certificados-ssh-18-cambiar-el-acceso-y-demostrar-quien-hizo-que/',
    'ca': 'https://oriolrius.blog/ca/2026/09/26/certificats-ssh-18-canviar-l-acces-i-demostrar-qui-va-fer-que/'
  },
  '19': {
    'en': 'https://oriolrius.blog/en/2026/09/27/ssh-principals-19-test-your-design/',
    'es': 'https://oriolrius.blog/es/2026/09/27/certificados-ssh-19-prueba-tu-diseno/',
    'ca': 'https://oriolrius.blog/ca/2026/09/27/certificats-ssh-19-posa-a-prova-el-teu-disseny/'
  }
};
const SERIES = (ep) => `https://oriolrius.blog/en/series/${Number(ep) >= 11 ? 'ssh-principals' : 'ssh-certificates'}/`;

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
    'Read the post (text, commands, diagram):',
    `English: ${BLOG[ep].en}`,
    `Spanish: ${BLOG[ep].es}`,
    `Catalan: ${BLOG[ep].ca}`,
    `Series page: ${SERIES(ep)}`,
    `Companion page and diagrams: ${DOCS}`,
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

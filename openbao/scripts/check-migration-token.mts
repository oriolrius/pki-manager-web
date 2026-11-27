/**
 * check-migration-token.mts — prove what a migration token (policy pki-manager-migration,
 * file scripts/migration/policies/pki-manager-migration.hcl) can and cannot do, and how
 * it is separated from the backend (runtime) token.
 *
 *   node openbao/scripts/check-migration-token.mts
 *
 * Needs Node >= 22.18 (runs TypeScript directly) and no other tool. Settings:
 * OPENBAO_ADDR, OPENBAO_CACERT, MIGRATION_TOKEN_FILE (from `bootstrap.sh migration-token`),
 * optional OPENBAO_TOKEN_FILE (the X.509/SSH backend token) and OPENBAO_RA_TOKEN_FILE (the
 * SCEP RA token) for the separation checks, OPENBAO_TRANSIT_MOUNT, OPENBAO_SSH_MOUNT,
 * OPENBAO_RA_MOUNT.
 *
 * With OPENBAO_TOKEN_FILE it also proves the runtime side: the backend token cannot
 * import or mint migration tokens, signs with the migrated X.509 and SSH keys, and has no
 * path on the RA mount. With OPENBAO_RA_TOKEN_FILE: the RA token alone recovers RA
 * session keys and signs with the migrated RA key, and has no X.509 or SSH path.
 *
 * WARN lines are defence in depth that the policy does not enforce today (import
 * parameters the tool never sends); they do not fail the check.
 *
 * It imports four throw-away keys named migcheck-<random> (X.509 exportable RSA, X.509
 * non-exportable P-384, SSH CA P-256, RA RSA-3072) with the Transit BYOK format, the same
 * as `pki-migrate apply`. Nobody with these tokens can delete them: run it against dev
 * and test stacks only, never production. Key names go to stderr.
 */
import { request } from 'node:https';
import { readFileSync } from 'node:fs';
import {
  constants, createCipheriv, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt,
  randomBytes, verify, type KeyObject,
} from 'node:crypto';

const env = (k: string, d?: string) => { const v = process.env[k] ?? d; if (!v) { console.error(`set ${k}`); process.exit(2); } return v; };
const addr = new URL(env('OPENBAO_ADDR'));
const ca = readFileSync(env('OPENBAO_CACERT'), 'utf8');
const migToken = readFileSync(env('MIGRATION_TOKEN_FILE'), 'utf8').trim();
const backendFile = process.env.OPENBAO_TOKEN_FILE;
const backendToken = backendFile ? readFileSync(backendFile, 'utf8').trim() : undefined;
const raFile = process.env.OPENBAO_RA_TOKEN_FILE;
const raToken = raFile ? readFileSync(raFile, 'utf8').trim() : undefined;
const X509 = env('OPENBAO_TRANSIT_MOUNT', 'pki-manager');
const SSH = env('OPENBAO_SSH_MOUNT', 'pki-manager-ssh');
const RA = env('OPENBAO_RA_MOUNT', 'pki-manager-ra');

type Res = { status: number; json: any };
function call(token: string, method: string, path: string, body?: unknown): Promise<Res> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'X-Vault-Token': token, 'X-Vault-Request': 'true' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
  return new Promise((resolve, reject) => {
    const req = request(new URL(`/v1/${path}`, addr), { method, headers, ca, timeout: 30_000 }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let json: any = {};
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let fails = 0, warns = 0;
async function warnUnless(want: RegExp, what: string, token: string, method: string, path: string, body?: unknown) {
  const r = await call(token, method, path, body);
  if (want.test(String(r.status))) console.log(`  ok    ${what} (${r.status})`);
  else { console.log(`  WARN  ${what}: HTTP ${r.status}, not refused by the policy`); warns++; }
}
function report(ok: boolean, what: string, detail: string) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what} (${detail})`);
  if (!ok) fails++;
}
async function expect(want: RegExp, what: string, token: string, method: string, path: string, body?: unknown): Promise<Res> {
  const r = await call(token, method, path, body);
  const err = Array.isArray(r.json?.errors) && r.json.errors.length ? `: ${String(r.json.errors.at(-1)).replace(/\s+/g, ' ').replace(/^1 error occurred: \* /, '').trim().slice(0, 90)}` : '';
  report(want.test(String(r.status)), what, `${r.status}${r.status >= 300 ? err : ''}`);
  return r;
}

const rnd = () => randomBytes(5).toString('hex');
async function wrapped(mount: string, priv: KeyObject): Promise<string> {
  const r = await call(migToken, 'GET', `${mount}/wrapping_key`);
  const wk = createPublicKey(r.json.data.public_key);
  const ephemeral = randomBytes(32);
  const head = publicEncrypt({ key: wk, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ephemeral);
  const kwp = createCipheriv('id-aes256-wrap-pad', ephemeral, Buffer.from('A65959A6', 'hex'));
  const der = priv.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  const blob = Buffer.concat([head, kwp.update(der), kwp.final()]);
  ephemeral.fill(0); der.fill(0);
  return blob.toString('base64');
}
const importBody = (ciphertext: string, type: string, exportable: boolean, extra: Record<string, unknown> = {}) =>
  ({ ciphertext, hash_function: 'SHA256', type, exportable, allow_plaintext_backup: false, allow_rotation: false, ...extra });

async function challenge(mount: string, name: string, pub: KeyObject, hash: 'sha2-256' | 'sha2-384', rsa: boolean, label: string) {
  const data = randomBytes(48);
  const body: Record<string, unknown> = { input: data.toString('base64'), key_version: 1, marshaling_algorithm: 'asn1' };
  if (rsa) body.signature_algorithm = 'pkcs1v15';
  const r = await call(migToken, 'POST', `${mount}/sign/${name}/${hash}`, body);
  const sig = typeof r.json?.data?.signature === 'string' ? Buffer.from(r.json.data.signature.replace(/^vault:v1:/, ''), 'base64') : Buffer.alloc(0);
  const ok = r.status === 200 && verify(hash === 'sha2-384' ? 'sha384' : 'sha256', data, { key: pub, dsaEncoding: 'der' }, sig);
  report(ok, `challenge signature verifies with the source public key: ${label}`, String(r.status));
}

async function readMatches(mount: string, name: string, pub: KeyObject, want: Record<string, unknown>, label: string) {
  const r = await call(migToken, 'GET', `${mount}/keys/${name}`);
  const d = r.json?.data ?? {};
  const pem = d.keys?.['1']?.public_key;
  const same = typeof pem === 'string' && createPublicKey(pem).export({ format: 'der', type: 'spki' }).equals(pub.export({ format: 'der', type: 'spki' }) as Buffer);
  const props = Object.entries(want).every(([k, v]) => d[k] === v);
  report(r.status === 200 && same && props && d.imported_key === true && d.latest_version === 1,
    `read ${label}: same public key, imported, version 1, ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(' ')}`, String(r.status));
}

async function main() {
  console.log(`migration token on ${addr.origin} (mounts ${X509}, ${SSH}, ${RA}):`);
  const self = await expect(/^200$/, 'look up itself', migToken, 'GET', 'auth/token/lookup-self');
  const d = self.json?.data ?? {};
  report(JSON.stringify(d.policies) === '["pki-manager-migration"]', 'only the pki-manager-migration policy (no default, no root)', JSON.stringify(d.policies));
  report(d.renewable === false && d.orphan === true && d.ttl > 0 && d.ttl <= 8 * 3600, 'not renewable, orphan, TTL at most 8h', `renewable=${d.renewable} orphan=${d.orphan} ttl=${d.ttl}`);
  for (const m of [X509, SSH, RA]) {
    const r = await expect(/^200$/, `mount ${m} type`, migToken, 'GET', `sys/internal/ui/mounts/${m}`);
    report(r.json?.data?.type === 'transit', `mount ${m} is transit`, String(r.json?.data?.type));
  }

  // Source keys, as Cosmian would export them (here generated locally).
  const leaf = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ca384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const sshCa = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raKey = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const n = { leaf: `migcheck-leaf-${rnd()}`, ca: `migcheck-ca-${rnd()}`, ssh: `migcheck-ssh-${rnd()}`, ra: `migcheck-ra-${rnd()}` };
  console.error(`check-migration-token: imports ${X509}/${n.leaf} ${X509}/${n.ca} ${SSH}/${n.ssh} ${RA}/${n.ra}`);

  console.log('permitted (X.509, SSH, SCEP RA):');
  await expect(/^20[04]$/, 'X.509: import an exportable rsa-2048 leaf key', migToken, 'POST', `${X509}/keys/${n.leaf}/import`, importBody(await wrapped(X509, leaf.privateKey), 'rsa-2048', true));
  await expect(/^20[04]$/, 'X.509: import a non-exportable ecdsa-p384 CA key', migToken, 'POST', `${X509}/keys/${n.ca}/import`, importBody(await wrapped(X509, ca384.privateKey), 'ecdsa-p384', false));
  await expect(/^20[04]$/, 'SSH: import a non-exportable ecdsa-p256 CA key', migToken, 'POST', `${SSH}/keys/${n.ssh}/import`, importBody(await wrapped(SSH, sshCa.privateKey), 'ecdsa-p256', false));
  await expect(/^20[04]$/, 'RA: import a non-exportable rsa-3072 key with session-key opt-in', migToken, 'POST', `${RA}/keys/${n.ra}/import`, importBody(await wrapped(RA, raKey.privateKey), 'rsa-3072', false, { allow_pkcs1v15_session_key: true }));
  await readMatches(X509, n.leaf, leaf.publicKey, { exportable: true, allow_plaintext_backup: false }, 'X.509 leaf');
  await readMatches(X509, n.ca, ca384.publicKey, { exportable: false, allow_plaintext_backup: false }, 'X.509 CA');
  await readMatches(SSH, n.ssh, sshCa.publicKey, { exportable: false, allow_plaintext_backup: false }, 'SSH CA');
  await readMatches(RA, n.ra, raKey.publicKey, { exportable: false, allow_plaintext_backup: false, allow_pkcs1v15_session_key: true }, 'RA');
  await challenge(X509, n.leaf, leaf.publicKey, 'sha2-256', true, 'X.509 leaf RSA');
  await challenge(X509, n.ca, ca384.publicKey, 'sha2-384', false, 'X.509 CA P-384');
  await challenge(SSH, n.ssh, sshCa.publicKey, 'sha2-256', false, 'SSH CA P-256');
  await challenge(RA, n.ra, raKey.publicKey, 'sha2-256', true, 'RA RSA-3072');
  const sessionKey = randomBytes(32);
  const ct = publicEncrypt({ key: raKey.publicKey, padding: constants.RSA_PKCS1_PADDING }, sessionKey);
  const sessionBody = { ciphertext: ct.toString('base64'), key_version: 1, session_key_length: 32 };

  console.log('refused (import policy):');
  const spare = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const spareRsa = generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey;
  await warnUnless(/^403$/, 'SSH: import an exportable key', migToken, 'POST', `${SSH}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(SSH, spare), 'ecdsa-p256', true));
  await warnUnless(/^403$/, 'RA: import an exportable key', migToken, 'POST', `${RA}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(RA, spareRsa), 'rsa-3072', true, { allow_pkcs1v15_session_key: true }));
  await warnUnless(/^403$/, 'RA: import a key of another type (rsa-2048)', migToken, 'POST', `${RA}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(RA, leaf.privateKey), 'rsa-2048', false, { allow_pkcs1v15_session_key: true }));
  await warnUnless(/^403$/, 'SSH: import a key of another type (ecdsa-p384)', migToken, 'POST', `${SSH}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(SSH, ca384.privateKey), 'ecdsa-p384', false));
  await warnUnless(/^403$/, 'X.509: import with allow_plaintext_backup=true', migToken, 'POST', `${X509}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(X509, spare), 'ecdsa-p256', true, { allow_plaintext_backup: true }));
  await warnUnless(/^403$/, 'X.509: import with allow_rotation=true', migToken, 'POST', `${X509}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(X509, spare), 'ecdsa-p256', false, { allow_rotation: true }));
  await warnUnless(/^403$/, 'X.509: import with an unlisted parameter (auto_rotate_period)', migToken, 'POST', `${X509}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(X509, spare), 'ecdsa-p256', false, { auto_rotate_period: '1h' }));
  await expect(/^403$/, 'X.509: import a new version into an existing key', migToken, 'POST', `${X509}/keys/${n.leaf}/import_version`, { ciphertext: await wrapped(X509, leaf.privateKey), hash_function: 'SHA256' });
  // The fork answers 500 here (upstream Transit), so check the reason too.
  const over = await call(migToken, 'POST', `${X509}/keys/${n.ca}/import`, importBody(await wrapped(X509, ca384.privateKey), 'ecdsa-p384', false));
  report(over.status >= 400 && /existing key/.test(JSON.stringify(over.json?.errors ?? [])), 'X.509: import over an existing key name', `${over.status}: ${String(over.json?.errors?.at(-1) ?? '').replace(/\s+/g, ' ').slice(0, 70)}`);

  console.log('refused (key export, configuration, other key operations):');
  await expect(/^403$/, 'X.509: export the exportable leaf key', migToken, 'GET', `${X509}/export/signing-key/${n.leaf}`);
  await expect(/^403$/, 'X.509: export version 1 of the leaf key', migToken, 'GET', `${X509}/export/signing-key/${n.leaf}/1`);
  await expect(/^403$/, 'SSH: export the SSH CA key', migToken, 'GET', `${SSH}/export/signing-key/${n.ssh}`);
  await expect(/^403$/, 'RA: export the RA key', migToken, 'GET', `${RA}/export/signing-key/${n.ra}`);
  await expect(/^403$/, 'X.509: backup a key', migToken, 'GET', `${X509}/backup/${n.leaf}`);
  await expect(/^403$/, 'X.509: restore a key', migToken, 'POST', `${X509}/restore/migcheck-x-${rnd()}`, { backup: 'AAAA' });
  await expect(/^403$/, 'X.509: make a key exportable', migToken, 'POST', `${X509}/keys/${n.ca}/config`, { exportable: true });
  await expect(/^403$/, 'SSH: turn on plaintext backup', migToken, 'POST', `${SSH}/keys/${n.ssh}/config`, { allow_plaintext_backup: true });
  await expect(/^403$/, 'RA: allow deletion', migToken, 'POST', `${RA}/keys/${n.ra}/config`, { deletion_allowed: true });
  await expect(/^403$/, 'X.509: generate a key', migToken, 'POST', `${X509}/keys/migcheck-x-${rnd()}`, { type: 'ecdsa-p256' });
  await expect(/^403$/, 'X.509: rotate a key', migToken, 'POST', `${X509}/keys/${n.leaf}/rotate`, {});
  await expect(/^403$/, 'X.509: delete a key', migToken, 'DELETE', `${X509}/keys/${n.leaf}`);
  await expect(/^403$/, 'X.509: list keys', migToken, 'LIST', `${X509}/keys`);
  await expect(/^403$/, 'RA: decrypt (OAEP)', migToken, 'POST', `${RA}/decrypt/${n.ra}`, { ciphertext: 'vault:v1:AAAA' });
  await expect(/^403$/, 'X.509: encrypt', migToken, 'POST', `${X509}/encrypt/${n.leaf}`, { plaintext: 'AAAA' });
  await expect(/^403$/, 'RA: recover a PKCS#1 v1.5 session key (SCEP, runtime only)', migToken, 'POST', `${RA}/session-key/pkcs1v15/${n.ra}`, sessionBody);

  console.log('refused (administration):');
  await expect(/^403$/, 'renew itself', migToken, 'POST', 'auth/token/renew-self', {});
  await expect(/^403$/, 'create a token', migToken, 'POST', 'auth/token/create', { policies: ['pki-manager-migration'] });
  await expect(/^403$/, 'create a token from the migration role', migToken, 'POST', 'auth/token/create/pki-manager-migration', {});
  await expect(/^403$/, 'look up a token by accessor', migToken, 'POST', 'auth/token/lookup-accessor', { accessor: d.accessor });
  await expect(/^403$/, 'read the backend AppRole role-id', migToken, 'GET', 'auth/approle/role/pki-manager-backend/role-id');
  await expect(/^403$/, 'issue a backend AppRole secret-id', migToken, 'POST', 'auth/approle/role/pki-manager-backend/secret-id', {});
  await expect(/^403$/, 'list mounts (sys)', migToken, 'GET', 'sys/mounts');
  await expect(/^403$/, 'enable a mount (sys)', migToken, 'POST', `sys/mounts/migcheck-${rnd()}`, { type: 'transit' });
  await expect(/^403$/, 'read a policy (sys)', migToken, 'GET', 'sys/policies/acl/pki-manager-migration');
  await expect(/^403$/, 'write a policy (sys)', migToken, 'POST', 'sys/policies/acl/pki-manager-migration', { policy: 'path "*" { capabilities = ["sudo"] }' });
  await expect(/^403$/, 'Raft snapshot (sys)', migToken, 'GET', 'sys/storage/raft/snapshot');
  await expect(/^403$/, 'read the backup pair marker (operator only)', migToken, 'GET', 'pki-manager-backup/pair-marker');
  await expect(/^403$/, 'write the backup pair marker (operator only)', migToken, 'POST', 'pki-manager-backup/pair-marker', { state: 'snapshot' });
  await expect(/^403$/, 'audit devices (sys)', migToken, 'GET', 'sys/audit');
  await expect(/^403$/, 'seal (sys)', migToken, 'POST', 'sys/seal', {});

  if (backendToken) {
    console.log('separation from the backend (runtime) token:');
    const b = (await call(backendToken, 'POST', 'auth/token/lookup-self')).json?.data;
    if (b) report(!(b.policies ?? []).includes('pki-manager-migration'), 'backend token has no migration policy', JSON.stringify(b.policies));
    await expect(/^403$/, 'backend token: read a wrapping key', backendToken, 'GET', `${X509}/wrapping_key`);
    await expect(/^403$/, 'backend token: import an X.509 key', backendToken, 'POST', `${X509}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(X509, spare), 'ecdsa-p256', false));
    await expect(/^403$/, 'backend token: import an SSH key', backendToken, 'POST', `${SSH}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(SSH, spare), 'ecdsa-p256', false));
    await expect(/^403$/, 'backend token: import_version', backendToken, 'POST', `${X509}/keys/${n.leaf}/import_version`, { ciphertext: 'AAAA' });
    await expect(/^403$/, 'backend token: RA session-key recovery (RA token only)', backendToken, 'POST', `${RA}/session-key/pkcs1v15/${n.ra}`, sessionBody);
    await expect(/^403$/, 'backend token: sign with the migrated RA key (RA token only)', backendToken, 'POST', `${RA}/sign/${n.ra}/sha2-256`, { input: randomBytes(32).toString('base64'), prehashed: true, signature_algorithm: 'pkcs1v15' });
    await expect(/^200$/, 'backend token: sign with the migrated X.509 CA key', backendToken, 'POST', `${X509}/sign/${n.ca}/sha2-384`, { input: randomBytes(32).toString('base64'), marshaling_algorithm: 'asn1' });
    await expect(/^200$/, 'backend token: sign with the migrated SSH CA key', backendToken, 'POST', `${SSH}/sign/${n.ssh}/sha2-256`, { input: randomBytes(32).toString('base64'), marshaling_algorithm: 'asn1' });
    await expect(/^200$/, 'backend token: export the migrated exportable leaf key (PKCS#12/PEM download)', backendToken, 'GET', `${X509}/export/signing-key/${n.leaf}/1`);
    await expect(/^400$/, 'backend token: export of the migrated non-exportable CA key is refused', backendToken, 'GET', `${X509}/export/signing-key/${n.ca}/1`);
    await expect(/^403$/, 'backend token: export the migrated SSH CA key', backendToken, 'GET', `${SSH}/export/signing-key/${n.ssh}`);
    await expect(/^403$/, 'backend token: export the migrated RA key', backendToken, 'GET', `${RA}/export/signing-key/${n.ra}`);
    await expect(/^403$/, 'backend token: create a migration token', backendToken, 'POST', 'auth/token/create/pki-manager-migration', {});
    await expect(/^403$/, 'backend token: create a token with the migration policy', backendToken, 'POST', 'auth/token/create', { policies: ['pki-manager-migration'] });
    await expect(/^403$/, 'backend token: read the migration token role', backendToken, 'GET', 'auth/token/roles/pki-manager-migration');
    await expect(/^403$/, 'backend token: revoke a token by accessor', backendToken, 'POST', 'auth/token/revoke-accessor', { accessor: d.accessor });
    await expect(/^403$/, 'backend token: import an RA key', backendToken, 'POST', `${RA}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(RA, spareRsa), 'rsa-3072', false, { allow_pkcs1v15_session_key: true }));
    const still = await call(migToken, 'GET', 'auth/token/lookup-self');
    report(still.status === 200, 'migration token still valid after the backend checks', String(still.status));
  }

  if (raToken) {
    console.log('separation of the SCEP RA (runtime) token:');
    report(raToken !== backendToken && raToken !== migToken, 'RA token is its own credential', 'compare');
    const rsk = await expect(/^200$/, 'RA token: session-key recovery on the migrated RA key (SCEP)', raToken, 'POST', `${RA}/session-key/pkcs1v15/${n.ra}`, sessionBody);
    report(typeof rsk.json?.data?.session_key === 'string' && Buffer.from(rsk.json.data.session_key, 'base64').equals(sessionKey), 'RA token: recovered session key equals the original', 'compare');
    await expect(/^200$/, 'RA token: sign with the migrated RA key', raToken, 'POST', `${RA}/sign/${n.ra}/sha2-256`, { input: randomBytes(32).toString('base64'), prehashed: true, signature_algorithm: 'pkcs1v15' });
    await expect(/^403$/, 'RA token: read a wrapping key', raToken, 'GET', `${RA}/wrapping_key`);
    await expect(/^403$/, 'RA token: import an RA key', raToken, 'POST', `${RA}/keys/migcheck-x-${rnd()}/import`, importBody(await wrapped(RA, spareRsa), 'rsa-3072', false, { allow_pkcs1v15_session_key: true }));
    await expect(/^403$/, 'RA token: export the migrated RA key', raToken, 'GET', `${RA}/export/signing-key/${n.ra}`);
    await expect(/^403$/, 'RA token: sign with the migrated X.509 CA key', raToken, 'POST', `${X509}/sign/${n.ca}/sha2-384`, { input: randomBytes(32).toString('base64'), marshaling_algorithm: 'asn1' });
    await expect(/^403$/, 'RA token: read the migrated X.509 CA key', raToken, 'GET', `${X509}/keys/${n.ca}`);
    await expect(/^403$/, 'RA token: export the migrated exportable leaf key', raToken, 'GET', `${X509}/export/signing-key/${n.leaf}/1`);
    await expect(/^403$/, 'RA token: sign with the migrated SSH CA key', raToken, 'POST', `${SSH}/sign/${n.ssh}/sha2-256`, { input: randomBytes(32).toString('base64'), marshaling_algorithm: 'asn1' });
    await expect(/^403$/, 'RA token: create a migration token', raToken, 'POST', 'auth/token/create/pki-manager-migration', {});
  }

  if (fails) { console.log(`check-migration-token: ${fails} check(s) FAILED, ${warns} warning(s)`); process.exit(1); }
  console.log(`check-migration-token: all checks passed, ${warns} warning(s)`);
}

main().catch(error => { console.error(`check-migration-token: ${(error as Error).message}`); process.exit(1); });

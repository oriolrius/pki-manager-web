/**
 * Golden-vector generator for the krl-client integration test (KRLC-11, TASK-169).
 *
 * Produces a self-consistent bundle in ../golden that proves REAL cross-
 * implementation interop end to end:
 *
 *   backend eciesEncryptV1 (node:crypto)  ->  Go decrypt.Open
 *   backend ECDSA-P256 DER signature      ->  Go verify.Check
 *   real `ssh-keygen -k` bare KRL         ->  Go install  ->  `ssh-keygen -Q`
 *
 * The ECIES ciphertext and the CA OpenSSH pubkey line are produced by the ACTUAL
 * backend source (not a re-implementation), so the committed vectors guard the
 * wire contract: if the backend crypto ever drifts, the Go test fails.
 *
 * Regenerate (from repo root) with:
 *   backend/node_modules/.bin/tsx \
 *     krl-client/internal/app/testdata/gen/generate-golden.mts
 *
 * All keys here are throwaway test material — never used outside the test suite.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The backend crypto under test — imported verbatim so the vectors are genuinely
// backend-produced (decision-015 / KRLC-02 local-decrypt model).
import { eciesEncryptV1 } from '../../../../../backend/src/crypto/ssh/ecies.js';
import { spkiToOpenSshEcdsa } from '../../../../../backend/src/crypto/ssh/pubkey.js';

const HOST_ID = 'web01.example.com';
const KRL_NUMBER = 42;
const VALID_UNTIL = 9999999999; // year 2286 — never expires under test

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'golden');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const kg = (...args: string[]) => execFileSync('ssh-keygen', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const p = (name: string) => join(out, name);

// 1. Host ecdsa-sha2-nistp256 key: private (Go loads it) + OpenSSH pub line
//    (the backend encrypts the KRL payload to it — decision-015 local decrypt).
kg('-t', 'ecdsa', '-b', '256', '-N', '', '-C', 'krl-golden-host', '-f', p('ssh_host_ecdsa_key'));
const hostPubLine = readFileSync(p('ssh_host_ecdsa_key.pub'), 'utf8').trim();

// 2. Two ed25519 user keys: one is revoked by the KRL, one stays valid — the
//    `ssh-keygen -Q` byte-compatibility assertions target these.
kg('-t', 'ed25519', '-N', '', '-C', 'revoked@golden', '-f', p('revoked_id'));
kg('-t', 'ed25519', '-N', '', '-C', 'valid@golden', '-f', p('valid_id'));

// 3. A REAL bare OpenSSH KRL (format 1) revoking revoked_id.pub. `-z KRL_NUMBER`
//    embeds the monotonic version in the KRL HEADER — the client's anti-rollback
//    source (TASK-175), so it must equal meta.krl_number below.
kg('-k', '-z', String(KRL_NUMBER), '-f', p('revoked_keys.krl'), p('revoked_id.pub'));
const krl = readFileSync(p('revoked_keys.krl'));
const krlSha256 = createHash('sha256').update(krl).digest('hex');
const version = `sha256:${krlSha256}`;

// 4. CA key: sign sha256(krl) as ECDSA-P256/DER; publish the CA as an OpenSSH
//    authorized-keys line (the TrustedUserCAKeys shape Go's verify.LoadCAKeys reads).
const ca = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const caPubLine = spkiToOpenSshEcdsa(ca.publicKey.export({ type: 'spki', format: 'pem' }), 'krl-golden-ca');
writeFileSync(p('ca.pub'), caPubLine + '\n');
// sign('sha256', krl, …) == ECDSA over sha256(krl), exactly what Go verifies.
const caSig = sign('sha256', krl, { key: ca.privateKey, dsaEncoding: 'der' });
writeFileSync(p('ca_signature.der'), caSig); // the detached DER signature, as a golden artifact

// 5. The decrypted payload (the exact bytes the ciphertext wraps). The monotonic
//    number is NOT carried here — it lives in the signed KRL header (TASK-175).
const payload = {
  krl: krl.toString('base64'),
  ca_signature: caSig.toString('base64'),
  krl_version: version,
  valid_until: VALID_UNTIL,
  host_id: HOST_ID,
};
const payloadBuf = Buffer.from(JSON.stringify(payload));
writeFileSync(p('payload.json'), payloadBuf);

// 6. The backend-produced ECIES envelope the fake PKI-Manager serves at 200.
const ciphertext = eciesEncryptV1(hostPubLine, payloadBuf);
writeFileSync(p('ciphertext.bin'), ciphertext);

// 7. Test-facing metadata (what the server advertises + what state must persist).
writeFileSync(
  p('meta.json'),
  JSON.stringify({ host_id: HOST_ID, krl_version: version, krl_number: KRL_NUMBER, valid_until: VALID_UNTIL, krl_sha256: krlSha256 }, null, 2) + '\n',
);

console.log(`golden vectors written to ${out}`);
console.log(`  krl=${krl.length}B version=${version} ciphertext=${ciphertext.length}B ca_sig=${caSig.length}B`);

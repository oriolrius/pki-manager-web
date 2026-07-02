/**
 * KRLC-02 — native ECIES v1 (local-decrypt KRL envelope). Proves the backend
 * can encrypt to a host's OpenSSH ecdsa-sha2-nistp256 public key and the holder
 * of the matching private key recovers the plaintext, with no KMS involved. The
 * cross-language parity with the Go host client is proven in the KRLC-02a spike.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eciesEncryptV1, eciesDecryptV1, EciesError, ECIES_EPH_LEN, ECIES_NONCE_LEN, ECIES_TAG_LEN } from './ecies.js';
import { spkiToOpenSshEcdsa } from './pubkey.js';

function ecdsaOpenSshPub(): { openssh: string; privatePem: ReturnType<typeof createPrivateKey> } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const openssh = spkiToOpenSshEcdsa(publicKey.export({ format: 'pem', type: 'spki' }) as string);
  return { openssh, privatePem: privateKey };
}

describe('ECIES v1 (native local-decrypt KRL envelope, KRLC-02)', () => {
  it('round-trips: encrypt to an OpenSSH ecdsa pubkey, decrypt with the private key', () => {
    const { openssh, privatePem } = ecdsaOpenSshPub();
    const plaintext = Buffer.from(
      JSON.stringify({ krl: 'AAAA', ca_signature: null, krl_version: 'sha256:abc', valid_until: 9999999999, host_id: 'h.example.com' })
    );
    const env = eciesEncryptV1(openssh, plaintext);
    expect(env.length).toBe(ECIES_EPH_LEN + ECIES_NONCE_LEN + plaintext.length + ECIES_TAG_LEN);
    expect(env[0]).toBe(0x04); // uncompressed ephemeral point
    expect(eciesDecryptV1(privatePem, env).equals(plaintext)).toBe(true);
  });

  it('is non-deterministic (fresh ephemeral key + nonce per call)', () => {
    const { openssh } = ecdsaOpenSshPub();
    const pt = Buffer.from('same-plaintext');
    const a = eciesEncryptV1(openssh, pt);
    const b = eciesEncryptV1(openssh, pt);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, ECIES_EPH_LEN).equals(b.subarray(0, ECIES_EPH_LEN))).toBe(false);
  });

  it('rejects a tampered ciphertext (AES-GCM authentication fails)', () => {
    const { openssh, privatePem } = ecdsaOpenSshPub();
    const env = eciesEncryptV1(openssh, Buffer.from('secret-krl-body'));
    env[env.length - 1] ^= 0x01; // flip a tag bit
    expect(() => eciesDecryptV1(privatePem, env)).toThrow();
  });

  it('rejects decryption with the wrong private key', () => {
    const { openssh } = ecdsaOpenSshPub();
    const other = ecdsaOpenSshPub();
    const env = eciesEncryptV1(openssh, Buffer.from('x'));
    expect(() => eciesDecryptV1(other.privatePem, env)).toThrow();
  });

  it('refuses to encrypt to an ed25519 key (P-256 required)', () => {
    const work = mkdtempSync(join(tmpdir(), 'ecies-ed-'));
    try {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'k'), '-N', '', '-q']);
      const edPub = readFileSync(join(work, 'k.pub'), 'utf8');
      expect(() => eciesEncryptV1(edPub, Buffer.from('x'))).toThrow(EciesError);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('decrypts a real OpenSSH ecdsa host key (parity with /etc/ssh/ssh_host_ecdsa_key)', () => {
    const work = mkdtempSync(join(tmpdir(), 'ecies-ec-'));
    try {
      // -m PEM gives a node-parseable SEC1 private key; .pub is the OpenSSH line the backend stores.
      execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-m', 'PEM', '-f', join(work, 'host'), '-N', '', '-q']);
      const pub = readFileSync(join(work, 'host.pub'), 'utf8');
      const priv = createPrivateKey(readFileSync(join(work, 'host'), 'utf8'));
      const pt = Buffer.from('revocation-list-bytes');
      const env = eciesEncryptV1(pub, pt);
      expect(eciesDecryptV1(priv, env).equals(pt)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

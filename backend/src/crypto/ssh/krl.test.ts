import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildKrl, krlVersion } from './krl.js';
import { parseSshPublicKey } from './pubkey.js';

let work: string;
const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });

/** True if ssh-keygen -Q reports the key/cert as revoked by the KRL. */
function isRevoked(krlPath: string, keyPath: string): boolean {
  const r = spawnSync('ssh-keygen', ['-Q', '-f', krlPath, keyPath], { encoding: 'utf8' });
  return r.status !== 0 && /REVOKED/i.test(r.stdout + r.stderr);
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'ssh-krl-test-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('buildKrl (SSH-20)', () => {
  it('produces an EXPLICIT_KEY KRL ssh-keygen -Q reports as REVOKED', () => {
    keygen(['-t', 'ed25519', '-f', join(work, 'k'), '-N', '', '-q']);
    keygen(['-t', 'ed25519', '-f', join(work, 'k2'), '-N', '', '-q']);
    const blob = parseSshPublicKey(readFileSync(join(work, 'k.pub'), 'utf8')).blob;
    const krl = buildKrl({ explicitKeys: [blob], krlVersionNumber: 1n });
    writeFileSync(join(work, 'krl1'), krl);
    expect(isRevoked(join(work, 'krl1'), join(work, 'k.pub'))).toBe(true);
    expect(isRevoked(join(work, 'krl1'), join(work, 'k2.pub'))).toBe(false);
  });

  it('is byte-identical to ssh-keygen -k for the same key (modulo date)', () => {
    keygen(['-t', 'ed25519', '-f', join(work, 'm'), '-N', '', '-q']);
    keygen(['-k', '-f', join(work, 'ref-krl'), join(work, 'm.pub')]);
    const ref = readFileSync(join(work, 'ref-krl'));
    // generated_date is bytes 0x14..0x1b (big-endian uint64).
    const date = ref.readBigUInt64BE(0x14);
    const blob = parseSshPublicKey(readFileSync(join(work, 'm.pub'), 'utf8')).blob;
    const mine = buildKrl({ explicitKeys: [blob], krlVersionNumber: 0n, generatedDate: date, comment: '' });
    expect(mine.equals(ref)).toBe(true);
  });

  it('revokes a certificate by serial (CERTIFICATES section) scoped to its CA', () => {
    keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, 'ca'), '-N', '', '-q']);
    keygen(['-t', 'ed25519', '-f', join(work, 'host'), '-N', '', '-q']);
    // Sign a host cert with serial 5.
    keygen(['-s', join(work, 'ca'), '-I', 'h', '-h', '-n', 'h.lab', '-z', '5', '-V', '+1w', join(work, 'host.pub')]);
    const caBlob = parseSshPublicKey(readFileSync(join(work, 'ca.pub'), 'utf8')).blob;
    const krl = buildKrl({ certSerials: [{ caKeyBlob: caBlob, serials: [5n] }], krlVersionNumber: 2n });
    writeFileSync(join(work, 'krl-serial'), krl);
    expect(isRevoked(join(work, 'krl-serial'), join(work, 'host-cert.pub'))).toBe(true);

    // A cert with a different serial is not revoked.
    keygen(['-s', join(work, 'ca'), '-I', 'h2', '-h', '-n', 'h2.lab', '-z', '6', '-V', '+1w', join(work, 'host.pub')]);
    expect(isRevoked(join(work, 'krl-serial'), join(work, 'host-cert.pub'))).toBe(false);
  });

  it('revokes by SHA256 key hash', () => {
    keygen(['-t', 'ed25519', '-f', join(work, 'fp'), '-N', '', '-q']);
    const blob = parseSshPublicKey(readFileSync(join(work, 'fp.pub'), 'utf8')).blob;
    const hash = createHash('sha256').update(blob).digest();
    const krl = buildKrl({ keyHashesSha256: [hash], krlVersionNumber: 3n });
    writeFileSync(join(work, 'krl-fp'), krl);
    expect(isRevoked(join(work, 'krl-fp'), join(work, 'fp.pub'))).toBe(true);
  });

  it('krlVersion is a stable sha256 over the exact bytes', () => {
    const a = buildKrl({ explicitKeys: [Buffer.from('x')], krlVersionNumber: 1n, generatedDate: 100n });
    const b = buildKrl({ explicitKeys: [Buffer.from('x')], krlVersionNumber: 1n, generatedDate: 100n });
    expect(a.equals(b)).toBe(true);
    expect(krlVersion(a)).toBe(krlVersion(b));
    expect(krlVersion(a).startsWith('sha256:')).toBe(true);
  });
});

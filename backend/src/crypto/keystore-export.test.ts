/**
 * Key and key store exports without the openssl executable.
 *
 * The backend runs with a PATH that has `java` and `keytool` but no `openssl`. The test side
 * checks each file with an independent openssl and keytool (absolute paths), so a file is good
 * only when another implementation reads it. Only PKCS#12 bundles with a private key still need
 * openssl (see pkcs12.ts); the last block proves that limit and the output when openssl is there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPublicKey, X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJavaKeyStore, createPkcs12Bundle, encryptPrivateKeyPem } from './pkcs12.js';
import { generateJKSKeystore, generateJKSTruststore } from '../services/jks.service.js';

const which = (cmd: string): string | null => {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};
const OPENSSL = which('openssl');
const KEYTOOL = which('keytool');
const JAVA = which('java');
const tools = Boolean(OPENSSL && KEYTOOL && JAVA);

let dir: string;
let savedPath: string | undefined;
const pki: Record<'rsaCa' | 'rsaLeaf' | 'ecCa' | 'ecLeaf', { cert: string; key: string }> = {} as never;

function ossl(args: string[], env: Record<string, string> = {}): string {
  return execFileSync(OPENSSL!, args, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function file(name: string, data: string | Buffer): string {
  const f = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  writeFileSync(f, data);
  return f;
}
/** `openssl pkcs12 -info` text plus the decoded PEM output (the password comes from env). */
function p12Info(p12: Buffer, password: string): string {
  const f = file('x.p12', p12);
  // -info writes the algorithms to stderr
  const r = spawnSync(OPENSSL!, ['pkcs12', '-in', f, '-info', '-nodes', '-passin', 'env:P'], {
    encoding: 'utf8', env: { ...process.env, P: password },
  });
  if (r.status !== 0) throw new Error(`openssl pkcs12 failed: ${r.stderr}`);
  return r.stderr + r.stdout;
}
/** `keytool -list -v` of a store, the password through env. */
function keytoolList(store: Buffer, type: 'PKCS12' | 'JKS', password: string): string {
  const f = file('x.ks', store);
  return execFileSync(KEYTOOL!, ['-list', '-v', '-keystore', f, '-storetype', type, '-storepass:env', 'KS'], {
    encoding: 'utf8',
    env: { ...process.env, KS: password, LC_ALL: 'C.UTF-8' },
  });
}
/** Converts a JKS key entry to PKCS#12 with keytool: proves the store and key passwords. */
function jksKeyOpens(jks: Buffer, alias: string, storePass: string, keyPass: string): boolean {
  const src = file('k.jks', jks);
  const dst = join(dir, `${Math.random().toString(36).slice(2)}.p12`);
  try {
    execFileSync(KEYTOOL!, ['-importkeystore', '-srckeystore', src, '-srcstoretype', 'JKS', '-srcstorepass:env', 'S',
      '-srcalias', alias, '-srckeypass:env', 'K', '-destkeystore', dst, '-deststoretype', 'PKCS12', '-deststorepass:env', 'D', '-noprompt'],
    { env: { ...process.env, S: storePass, K: keyPass, D: 'converted', LC_ALL: 'C.UTF-8' }, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeCert(name: string, keyArgs: string[], issuer?: { cert: string; key: string }): { cert: string; key: string } {
  const key = join(dir, `${name}.key`);
  const cert = join(dir, `${name}.pem`);
  ossl(['genpkey', ...keyArgs, '-out', key]);
  if (!issuer) {
    ossl(['req', '-x509', '-key', key, '-out', cert, '-days', '2', '-subj', `/CN=${name} CA/O=Mixed Case Org/C=ES`,
      '-addext', 'basicConstraints=critical,CA:TRUE']);
  } else {
    const csr = join(dir, `${name}.csr`);
    ossl(['req', '-new', '-key', key, '-out', csr, '-subj', `/CN=${name}.example/O=Mixed Case Org/C=ES`]);
    ossl(['x509', '-req', '-in', csr, '-CA', file('ca.pem', issuer.cert), '-CAkey', file('ca.key', issuer.key),
      '-CAcreateserial', '-out', cert, '-days', '2']);
  }
  return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') };
}

describe.skipIf(!tools)('key store exports without the openssl executable', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pki-export-'));
    pki.rsaCa = makeCert('rsa', ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048']);
    pki.rsaLeaf = makeCert('rsaleaf', ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'], pki.rsaCa);
    pki.ecCa = makeCert('ec', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256']);
    pki.ecLeaf = makeCert('ecleaf', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-384'], pki.ecCa);
    // The backend sees only java and keytool.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    symlinkSync(JAVA!, join(bin, 'java'));
    symlinkSync(KEYTOOL!, join(bin, 'keytool'));
    savedPath = process.env.PATH;
    process.env.PATH = bin;
    expect(() => execFileSync('openssl', ['version'], { stdio: 'ignore' })).toThrow(/ENOENT/);
  });

  afterAll(() => {
    if (savedPath !== undefined) process.env.PATH = savedPath;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  describe('encrypted PKCS#8 (Node crypto)', () => {
    it.each([
      ['RSA', 'rsaLeaf', 'Long-Pass-123'],
      ['EC', 'ecLeaf', 'pässwörd€'],
      ['EC short password', 'ecLeaf', 'a'],
    ] as const)('%s: openssl decrypts the PBES2 AES-256-CBC key', async (_label, which, password) => {
      const pem = await encryptPrivateKeyPem(pki[which].key, password);
      expect(pem).toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');
      const f = file('enc.pem', pem);
      const asn1 = ossl(['asn1parse', '-in', f]);
      expect(asn1).toContain(':PBES2');
      expect(asn1).toContain(':PBKDF2');
      expect(asn1).toContain(':hmacWithSHA256');
      expect(asn1).toContain(':aes-256-cbc');
      const der = ossl(['pkey', '-in', f, '-passin', 'env:P', '-pubout'], { P: password });
      expect(der).toBe(createPublicKey(pki[which].key).export({ type: 'spki', format: 'pem' }));
    });

    it('rejects an empty password', async () => {
      await expect(encryptPrivateKeyPem(pki.rsaLeaf.key, '')).rejects.toThrow(/password is required/);
    });
  });

  describe('PKCS#12 truststore (Java KeyStore API)', () => {
    it.each([
      ['modern, default password', false, 'changeit', /PBES2, PBKDF2, AES-256-CBC.*hmacWithSHA256/, /MAC: sha256/],
      ['legacy, short password', true, 'abc', /pbeWithSHA1And3-KeyTripleDES-CBC/, /MAC: sha1/],
      ['modern, empty password', false, '', /PBES2, PBKDF2, AES-256-CBC/, /MAC: sha256/],
    ] as const)('%s: a trustedCertEntry that openssl and keytool read', async (_l, legacy, password, pbe, mac) => {
      const p12 = await createPkcs12Bundle({ certPem: pki.rsaCa.cert, privateKeyPem: null, password, legacy, friendlyName: 'rsa-root' });
      const info = p12Info(p12, password);
      expect(info).toMatch(pbe);
      expect(info).toMatch(mac);
      expect(info).toContain('friendlyName: rsa-root');
      expect(info).not.toContain('PRIVATE KEY');
      const list = keytoolList(p12, 'PKCS12', password);
      expect(list).toContain('Alias name: rsa-root');
      expect(list).toContain('Entry type: trustedCertEntry');
    });
  });

  it('legacy PKCS#12 truststore: a non-ASCII password is an error, not an unreadable file', async () => {
    await expect(createPkcs12Bundle({ certPem: pki.rsaCa.cert, privateKeyPem: null, password: 'pässwörd', legacy: true }))
      .rejects.toThrow(/ASCII password/);
    const modern = await createPkcs12Bundle({ certPem: pki.rsaCa.cert, privateKeyPem: null, password: 'pässwörd€', friendlyName: 'root' });
    expect(p12Info(modern, 'pässwörd€')).toContain('friendlyName: root');
  });

  describe('JKS (Java KeyStore API)', () => {
    it.each([
      ['RSA', 'rsaLeaf', 'rsaCa', 'Store-Pass-1'],
      ['EC', 'ecLeaf', 'ecCa', 'pässwörd€'],
      ['EC short password', 'ecLeaf', 'ecCa', 'abc'],
    ] as const)('%s keystore: PrivateKeyEntry with the CA chain', async (_l, leaf, ca, password) => {
      const res = await generateJKSKeystore({
        certificatePem: pki[leaf].cert, privateKeyPem: pki[leaf].key, caCertificatePem: pki[ca].cert,
        password, alias: 'leaf', commonName: 'leaf', serialShort: '01',
      });
      const jks = Buffer.from(res.data, 'base64');
      const list = keytoolList(jks, 'JKS', password);
      expect(list).toContain('Keystore type: JKS');
      expect(list).toContain('Entry type: PrivateKeyEntry');
      expect(list).toContain('Certificate chain length: 2');
      expect(jksKeyOpens(jks, 'leaf', password, password)).toBe(true);
    });

    it('keystore without a password: store "changeit", key entry with an empty password (as before)', async () => {
      const res = await generateJKSKeystore({
        certificatePem: pki.rsaCa.cert, privateKeyPem: pki.rsaCa.key, caCertificatePem: pki.rsaCa.cert,
        alias: 'self', commonName: 'self', serialShort: '01',
      });
      const jks = Buffer.from(res.data, 'base64');
      expect(keytoolList(jks, 'JKS', 'changeit')).toContain('Certificate chain length: 1');
      expect(jksKeyOpens(jks, 'self', 'changeit', '')).toBe(true);
    });

    it('truststore: trustedCertEntry with the lowercased CA alias', async () => {
      const res = await generateJKSTruststore({
        caCertificatePem: pki.ecCa.cert, caSubjectDn: 'CN=EC Root,O=Mixed Case Org', commonName: 'ec', serialShort: '01',
      });
      const list = keytoolList(Buffer.from(res.data, 'base64'), 'JKS', 'changeit');
      expect(list).toContain('Alias name: ca-ec_root');
      expect(list).toContain('Entry type: trustedCertEntry');
    });

    it('rejects a key that does not match the certificate', async () => {
      await expect(createJavaKeyStore({
        type: 'JKS', storePassword: 'changeit', alias: 'x', privateKeyPem: pki.ecLeaf.key, certPems: [pki.rsaLeaf.cert],
      })).rejects.toThrow(/does not match/);
    });

    it('a PKCS#12 key entry (bulk JKS source) keeps the chain and an empty password', async () => {
      const p12 = await createJavaKeyStore({
        type: 'PKCS12', storePassword: '', alias: 'bulk-01', privateKeyPem: pki.ecLeaf.key,
        certPems: [pki.ecLeaf.cert, pki.ecCa.cert],
      });
      const info = p12Info(p12, '');
      expect(info).toContain('friendlyName: bulk-01');
      expect(info.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(2);
      expect(info).toContain('-----BEGIN PRIVATE KEY-----');
    });
  });

  describe('PKCS#12 bundle with a private key (the one operation that needs openssl)', () => {
    it('fails without openssl on PATH', async () => {
      await expect(createPkcs12Bundle({ certPem: pki.rsaLeaf.cert, privateKeyPem: pki.rsaLeaf.key, password: 'x' }))
        .rejects.toThrow(/ENOENT/);
    });

    it.each([
      ['RSA modern', 'rsaLeaf', 'rsaCa', false, 'Long-Pass-123'],
      ['EC legacy, non-ASCII', 'ecLeaf', 'ecCa', true, 'pässwörd€'],
      ['EC modern, empty password', 'ecLeaf', 'ecCa', false, ''],
    ] as const)('with openssl: %s keeps the friendlyName case and the chain', async (_l, leaf, ca, legacy, password) => {
      process.env.PATH = `${join(dir, 'bin')}:${OPENSSL!.replace(/\/openssl$/, '')}`;
      try {
        const subjectDn = new X509Certificate(pki[leaf].cert).subject.split('\n').join(',');
        const p12 = await createPkcs12Bundle({
          certPem: pki[leaf].cert, privateKeyPem: pki[leaf].key, chainPems: [pki[ca].cert], password, legacy, friendlyName: subjectDn,
        });
        const info = p12Info(p12, password);
        expect(info).toContain(`friendlyName: ${subjectDn}`);
        expect(info.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(2);
        expect(info).toMatch(legacy ? /pbeWithSHA1And3-KeyTripleDES-CBC/ : /PBES2, PBKDF2, AES-256-CBC/);
      } finally {
        process.env.PATH = join(dir, 'bin');
      }
    });
  });
});

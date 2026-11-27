/**
 * X.509 key store service with an in-memory key store (same contract as OpenBao Transit).
 * Every certificate and CRL is checked with Node crypto and, when present, the OpenSSL CLI
 * (`openssl verify -x509_strict`, `openssl crl -verify`), not with the service's own parser.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { X509Certificate, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { keystoreObjects } from '../db/schema.js';
import { MemoryKeyStore } from '../test/memory-keystore.js';
import { KeyNotExportableError, KeyStoreObjectNotFoundError, KeyStoreStateError, X509KeyStoreService } from './x509-store.js';
import { buildCertificateExtensions } from '../services/certificate.service.js';
import { generateCRLWithSigner, parseCRL } from '../crypto/crl.js';
import { CRLReason } from '../crypto/types.js';

const OPENSSL = spawnSync('openssl', ['version']).status === 0;
const CA_EXT = '[ v3_ca ]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,crlSign\nsubjectKeyIdentifier=hash\n';
const SUBJECT = 'CN=Test Root,OU=Release,O=Acceptance Test,L=Barcelona,ST=Barcelona,C=ES';

let dir: string;
const file = (name: string, content: string) => { const p = join(dir, name); writeFileSync(p, content); return p; };
const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function verifyChain(caPem: string, leafPem: string): void {
  if (!OPENSSL) return;
  const out = openssl('verify', '-x509_strict', '-CAfile', file('ca.pem', caPem), file('leaf.pem', leafPem));
  expect(out).toContain(': OK');
}
const text = (pem: string) => (OPENSSL ? openssl('x509', '-in', file('t.pem', pem), '-noout', '-text') : '');

function csr(keyArgs: string[], subj: string, ...ext: string[]): string {
  const key = join(dir, `k-${Math.random()}.pem`);
  const args = ['req', '-new', '-newkey', ...keyArgs, '-nodes', '-keyout', key, '-subj', subj];
  for (const e of ext) args.push('-addext', e);
  return openssl(...args);
}

const store = new MemoryKeyStore();
const service = new X509KeyStoreService(store);

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'x509-store-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

async function makeCa(alg: string) {
  const r = await service.certify({ subjectName: SUBJECT, daysValid: 3650, keyAlgorithm: alg, x509Extensions: CA_EXT, tags: ['t'] });
  return { ...r, pem: await service.getCertificatePem(r.certificateId) };
}

describe('X509KeyStoreService: self-signed CAs', () => {
  for (const alg of ['RSA-2048', 'ECDSA-P256', 'ECDSA-P384']) {
    it(`builds a ${alg} root that verifies with itself`, async () => {
      const ca = await makeCa(alg);
      const x = new X509Certificate(ca.pem);
      expect(x.verify(x.publicKey)).toBe(true);
      expect(x.ca).toBe(true);
      expect(x.subject.split('\n')).toEqual(['CN=Test Root', 'OU=Release', 'C=ES', 'ST=Barcelona', 'L=Barcelona', 'O=Acceptance Test']);
      expect(x.issuer).toBe(x.subject);
      expect(Buffer.from(ca.certificateData, 'hex').equals(x.raw)).toBe(true);
      const days = (new Date(x.validTo).getTime() - new Date(x.validFrom).getTime()) / 86_400_000;
      expect(days).toBe(3650);
      expect(x.serialNumber.length).toBe(40); // 20 octets
      expect(parseInt(x.serialNumber[0], 16)).toBeLessThan(8); // positive
      verifyChain(ca.pem, ca.pem);
      if (OPENSSL) {
        const t = text(ca.pem);
        expect(t).toMatch(/Basic Constraints: critical\s+CA:TRUE/);
        expect(t).toMatch(/Key Usage: critical\s+Certificate Sign, CRL Sign/);
        expect(t).toContain('Subject Key Identifier');
        expect(t).toContain(alg === 'ECDSA-P384' ? 'ecdsa-with-SHA384' : alg === 'ECDSA-P256' ? 'ecdsa-with-SHA256' : 'sha256WithRSAEncryption');
      }
      // key pair rows and links
      expect(ca.privateKeyId).toBeTruthy();
      expect(await service.getCertificatePrivateKeyId(ca.certificateId)).toBe(ca.privateKeyId);
      expect(await service.getPublicKeyIdForPrivateKey(ca.privateKeyId!)).toBe(ca.publicKeyId);
      const [row] = await db.select().from(keystoreObjects).where(eq(keystoreObjects.id, ca.privateKeyId!));
      expect(row.keyName).toBe(`x509-ca-${ca.privateKeyId}`);
      expect(row.exportable).toBe(false); // ALLOW_CA_KEY_EXPORT off
      expect(row.state).toBe('active');
    });
  }
});

describe('X509KeyStoreService: leaf certificates for key store key pairs', () => {
  const cases: Array<[string, string]> = [['RSA-2048', 'RSA-2048'], ['RSA-2048', 'ECDSA-P256'], ['ECDSA-P384', 'ECDSA-P256'], ['ECDSA-P256', 'RSA-2048']];
  for (const [caAlg, leafAlg] of cases) {
    it(`${leafAlg} leaf issued by a ${caAlg} CA keeps SAN, KU, EKU, SKI/AKI and CDP`, async () => {
      const ca = await makeCa(caAlg);
      const pair = await service.createKeyPair({ keyAlgorithm: leafAlg, purpose: 'certificate', tags: ['leaf'] });
      const ext = buildCertificateExtensions({
        certificateType: 'dual', sanDns: ['a.example.test', '*.b.example.test'], sanIp: ['10.0.0.1', '2001:db8::1'], sanEmail: ['ops@example.test'],
        cdpUrl: 'https://pki.example.test/crl/x.crl',
      });
      const r = await service.certify({
        publicKeyId: pair.publicKeyId, issuerCertificateId: ca.certificateId, issuerName: 'ignored',
        subjectName: 'CN=leaf.example.test,O=Example\\, Inc,C=US', daysValid: 90, x509Extensions: ext,
      } as never);
      expect(r.privateKeyId).toBe(pair.privateKeyId);
      expect(r.publicKeyId).toBe(pair.publicKeyId);
      const x = new X509Certificate(r.certificatePem);
      expect(x.verify(new X509Certificate(ca.pem).publicKey)).toBe(true);
      expect(x.checkIssued(new X509Certificate(ca.pem))).toBe(true);
      expect(x.subject).toContain('O=Example\\, Inc');
      expect(x.subjectAltName).toBe('DNS:a.example.test, DNS:*.b.example.test, IP Address:10.0.0.1, IP Address:2001:DB8:0:0:0:0:0:1, email:ops@example.test');
      expect(x.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(await service.getPublicKeyPem(pair.publicKeyId)).export({ type: 'spki', format: 'der' }))).toBe(true);
      verifyChain(ca.pem, r.certificatePem);
      if (OPENSSL) {
        const t = text(r.certificatePem);
        expect(t).toMatch(/Basic Constraints: critical\s+CA:FALSE/);
        expect(t).toMatch(/Key Usage: critical\s+Digital Signature, Key Encipherment/);
        expect(t).toMatch(/Extended Key Usage:\s+TLS Web Server Authentication, TLS Web Client Authentication/);
        expect(t).toContain('URI:https://pki.example.test/crl/x.crl');
        const ski = openssl('x509', '-in', file('ca2.pem', ca.pem), '-noout', '-ext', 'subjectKeyIdentifier').split('\n')[1].trim();
        const aki = openssl('x509', '-in', file('l2.pem', r.certificatePem), '-noout', '-ext', 'authorityKeyIdentifier').split('\n')[1].trim().replace(/^keyid:/, '');
        expect(aki).toBe(ski);
      }
      // the exported leaf key matches the certificate
      const keyPem = await service.exportPrivateKeyPem(pair.privateKeyId);
      expect(createPublicKey(createPrivateKey(keyPem)).export({ type: 'spki', format: 'der' }).equals(x.publicKey.export({ type: 'spki', format: 'der' }))).toBe(true);
    });
  }

  it('clamps the validity to the days left on the issuer', async () => {
    const ca = await service.certify({ subjectName: 'CN=Short CA,O=T,C=ES', daysValid: 10, keyAlgorithm: 'ECDSA-P256', x509Extensions: CA_EXT });
    const pair = await service.createKeyPair({ keyAlgorithm: 'ECDSA-P256', purpose: 'certificate' });
    const r = await service.certify({ publicKeyId: pair.publicKeyId, issuerCertificateId: ca.certificateId, subjectName: 'CN=x,O=T,C=ES', daysValid: 365 });
    const x = new X509Certificate(r.certificatePem);
    expect(new Date(x.validTo).getTime()).toBeLessThanOrEqual(new Date(new X509Certificate(ca.certificatePem).validTo).getTime());
  });

  it('refuses a non-CA issuer and an unknown extension key', async () => {
    const ca = await makeCa('ECDSA-P256');
    const pair = await service.createKeyPair({ keyAlgorithm: 'ECDSA-P256', purpose: 'certificate' });
    const leaf = await service.certify({ publicKeyId: pair.publicKeyId, issuerCertificateId: ca.certificateId, subjectName: 'CN=x,O=T,C=ES', x509Extensions: '[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\n' });
    await expect(service.certify({ publicKeyId: pair.publicKeyId, issuerCertificateId: leaf.certificateId, subjectName: 'CN=y,O=T,C=ES' })).rejects.toThrow(/not a CA/);
    await expect(service.certify({ publicKeyId: pair.publicKeyId, issuerCertificateId: ca.certificateId, subjectName: 'CN=y,O=T,C=ES', x509Extensions: '[ v3_ca ]\nnameConstraints=critical,permitted;DNS:x\n' })).rejects.toThrow(/unsupported extension/);
  });
});

describe('X509KeyStoreService: CSR signing (external issuance)', () => {
  it.skipIf(!OPENSSL)('keeps an RSA CSR subject, key and requested extensions; adds CA:FALSE and the CDP', async () => {
    const ca = await makeCa('RSA-2048');
    const pem = csr(['rsa:2048'], '/CN=svc.example.test/O=Ext', 'subjectAltName=DNS:svc.example.test,IP:192.0.2.7', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=serverAuth');
    const r = await service.issueFromCsr({ csrPem: pem, issuerCertificateId: ca.certificateId, daysValid: 30, x509Extensions: '[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\ncrlDistributionPoints=URI:http://pki.test/crl\n' });
    expect(r.privateKeyId).toBeUndefined();
    const x = new X509Certificate(r.certificatePem);
    expect(x.subject).toBe('CN=svc.example.test\nO=Ext');
    expect(x.subjectAltName).toBe('DNS:svc.example.test, IP Address:192.0.2.7');
    const csrKey = openssl('req', '-in', file('r.csr', pem), '-noout', '-pubkey').trim();
    expect(x.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()).toBe(csrKey);
    verifyChain(ca.pem, r.certificatePem);
    const t = text(r.certificatePem);
    expect(t).toMatch(/Key Usage: critical\s+Digital Signature/);
    expect(t).toMatch(/Basic Constraints: critical\s+CA:FALSE/);
    expect(t).toContain('URI:http://pki.test/crl');
  });

  it.skipIf(!OPENSSL)('signs P-256 and P-384 CSRs with an RSA CA, and an RSA CSR with a P-384 CA', async () => {
    const rsaCa = await makeCa('RSA-2048');
    for (const curve of ['prime256v1', 'secp384r1']) {
      const pem = csr(['ec', '-pkeyopt', `ec_paramgen_curve:${curve}`], '/CN=ec.example.test', 'subjectAltName=DNS:ec.example.test');
      const r = await service.issueFromCsr({ csrPem: pem, issuerCertificateId: rsaCa.certificateId, daysValid: 30, x509Extensions: '[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\n' });
      verifyChain(rsaCa.pem, r.certificatePem);
    }
    const ecCa = await makeCa('ECDSA-P384');
    const pem = csr(['rsa:3072'], '/CN=rsa.example.test', 'subjectAltName=DNS:rsa.example.test');
    const r = await service.issueFromCsr({ csrPem: pem, issuerCertificateId: ecCa.certificateId, daysValid: 30, x509Extensions: '[ v3_ca ]\nbasicConstraints=critical,CA:FALSE\n' });
    verifyChain(ecCa.pem, r.certificatePem);
    expect(text(r.certificatePem)).toContain('ecdsa-with-SHA384');
  });

  it.skipIf(!OPENSSL)('keeps an explicit CA:FALSE from the CSR and refuses CA:TRUE, bad signatures and duplicates', async () => {
    const ca = await makeCa('ECDSA-P256');
    const ok = csr(['ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'], '/CN=bc', 'basicConstraints=CA:FALSE');
    const r = await service.issueFromCsr({ csrPem: ok, issuerCertificateId: ca.certificateId, daysValid: 1, x509Extensions: '[ v3_ca ]\n' });
    expect(text(r.certificatePem)).toMatch(/Basic Constraints:\s+CA:FALSE/);

    const caTrue = csr(['ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'], '/CN=bad', 'basicConstraints=critical,CA:TRUE');
    await expect(service.issueFromCsr({ csrPem: caTrue, issuerCertificateId: ca.certificateId, daysValid: 1 })).rejects.toThrow(/CA:TRUE/);

    // Flip one byte of the signature.
    const der = Buffer.from(ok.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
    der[der.length - 5] ^= 0x01;
    const tampered = `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString('base64')}\n-----END CERTIFICATE REQUEST-----\n`;
    await expect(service.issueFromCsr({ csrPem: tampered, issuerCertificateId: ca.certificateId, daysValid: 1 })).rejects.toThrow();

    await expect(service.certify({ csr: ok, issuerCertificateId: ca.certificateId })).rejects.toThrow(/preserveCsrKey/);
    const small = csr(['rsa:1024'], '/CN=small');
    await expect(service.issueFromCsr({ csrPem: small, issuerCertificateId: ca.certificateId, daysValid: 1 })).rejects.toThrow(/2048/);
  });
});

describe('X509KeyStoreService: export, CRL signing and lifecycle', () => {
  it('exports a CA key only when CA key export was on at creation', async () => {
    const locked = await makeCa('RSA-2048');
    await expect(service.exportPrivateKeyPem(locked.privateKeyId!)).rejects.toBeInstanceOf(KeyNotExportableError);
    store.caKeysExportable = true;
    try {
      const open = await makeCa('RSA-2048');
      const pem = await service.exportPrivateKeyPem(open.privateKeyId!);
      expect(pem).toContain('BEGIN PRIVATE KEY');
    } finally { store.caKeysExportable = false; }
  });

  it.skipIf(!OPENSSL)('signs a CRL with the CA key in the key store; openssl verifies it', async () => {
    for (const alg of ['RSA-2048', 'ECDSA-P256']) {
      const ca = await makeCa(alg);
      const crl = await generateCRLWithSigner({
        issuer: { CN: 'Test Root', O: 'Acceptance Test', C: 'ES' },
        crlNumber: 7,
        revokedCertificates: [{ serialNumber: '0a1b2c', revocationDate: new Date(), reason: CRLReason.KEY_COMPROMISE }],
        signatureAlgorithm: alg === 'RSA-2048' ? 'SHA256-RSA' : 'SHA256-ECDSA',
        issuerCertificate: ca.pem,
        signer: (tbs, hash) => service.signData(ca.privateKeyId!, tbs, hash),
      });
      const out = execFileSync('openssl', ['crl', '-in', file('c.crl', crl.pem), '-CAfile', file('cca.pem', ca.pem), '-noout', '-text'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(out).toContain('X509v3 Authority Key Identifier');
      const verify = spawnSync('openssl', ['crl', '-in', join(dir, 'c.crl'), '-CAfile', join(dir, 'cca.pem'), '-noout'], { encoding: 'utf8' });
      expect(verify.stderr + verify.stdout).toContain('verify OK');
      expect(parseCRL(crl.pem).revokedCertificates.map((c) => c.serialNumber.toLowerCase())).toContain('0a1b2c');
    }
  });

  it('revoke and destroy make the key unusable; destroyed keys leave Transit', async () => {
    const ca = await makeCa('ECDSA-P256');
    await service.revoke(ca.privateKeyId!);
    await expect(service.signData(ca.privateKeyId!, Buffer.from('x'), 'sha256')).rejects.toBeInstanceOf(KeyStoreStateError);
    const pair = await service.createKeyPair({ keyAlgorithm: 'ECDSA-P256', purpose: 'certificate' });
    const [row] = await db.select().from(keystoreObjects).where(eq(keystoreObjects.id, pair.privateKeyId));
    expect(store.keys.has(row.keyName!)).toBe(true);
    await service.destroy(pair.privateKeyId);
    expect(store.keys.has(row.keyName!)).toBe(false);
    const rows = await db.select().from(keystoreObjects).where(eq(keystoreObjects.keyName, row.keyName!));
    expect(rows.map((r) => r.state)).toEqual(['destroyed', 'destroyed']);
    await expect(service.exportPrivateKeyPem(pair.privateKeyId)).rejects.toThrow(/destroyed/);
    await service.destroy(pair.privateKeyId); // idempotent
  });

  it('reports a legacy (unmigrated) object id with KEY_MIGRATION_REQUIRED', async () => {
    const err = await service.getCertificatePem('cosmian-legacy-id').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyStoreObjectNotFoundError);
    expect((err as KeyStoreObjectNotFoundError).code).toBe('KEY_MIGRATION_REQUIRED');
  });

  it('refuses a certificate whose issuer key does not match the issuer certificate', async () => {
    const ca = await makeCa('ECDSA-P256');
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await db.update(keystoreObjects).set({ publicKeyPem: other }).where(eq(keystoreObjects.id, ca.privateKeyId!));
    const pair = await service.createKeyPair({ keyAlgorithm: 'ECDSA-P256', purpose: 'certificate' });
    await expect(service.certify({ publicKeyId: pair.publicKeyId, issuerCertificateId: ca.certificateId, subjectName: 'CN=x,O=T,C=ES' })).rejects.toThrow(/do not match/);
  });

  it('never stores private key material in SQLite', async () => {
    const rows = await db.select().from(keystoreObjects);
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain('PRIVATE KEY');
    }
  });
});

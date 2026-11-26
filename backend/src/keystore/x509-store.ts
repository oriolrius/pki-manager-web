/**
 * X.509 key and certificate store on OpenBao Transit (decision-018, doc-012 §3).
 *
 * It replaces the Cosmian object store with the same object model, so the existing
 * `kms_certificate_id` / `kms_key_id` columns keep their meaning:
 *
 * - a key pair is two rows (private key, public key) that point at one Transit key version;
 * - a certificate is one row with its PEM and links to its key rows and its issuer certificate;
 * - certificates are built locally (`crypto/x509-builder.ts`) and signed in Transit;
 * - the public PEMs live in SQLite; private key material never does.
 *
 * Ids are never chosen by an API caller: services pass ids read from their own rows.
 * An id that has no row here is a legacy Cosmian object, which needs the key migration.
 */
import { createPrivateKey, createPublicKey, randomUUID, verify as nodeVerify, type KeyObject } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { keystoreObjects, type KeystoreObject } from '../db/schema.js';
import { parseDN } from '../crypto/dn.js';
import { TAG, bitStringBytes, child, derToPem, parseDer, pemToDer } from '../crypto/der.js';
import { OID, buildExtensionsFromConfig, keyIdentifier, type EncodedExtension } from '../crypto/x509-extensions.js';
import {
  CertificateBuildError, buildCertificate, encodeName, mergeExtensions, parseCertificateDer, parseCsr, randomSerial,
  signatureAlgorithmFor, validityWindow, type NameFields, type ParsedCertificate,
} from '../crypto/x509-builder.js';
import { OpenBaoKeyStore } from './openbao.js';
import { toKeyAlg, type KeyAlg, type KeyRef, type KeyStore, type KeyStoreState, type SignHash } from './types.js';

export const KEY_MIGRATION_REQUIRED = 'KEY_MIGRATION_REQUIRED';

/** An id with no key store row: a Cosmian object that the migration has not moved yet. */
export class KeyStoreObjectNotFoundError extends Error {
  readonly code = KEY_MIGRATION_REQUIRED;
  constructor(readonly objectId: string) {
    super(`Key store object ${objectId} is not in the OpenBao key store; run the key migration`);
  }
}

export class KeyStoreStateError extends Error {}

export class KeyNotExportableError extends Error {
  readonly code = 'KEY_NOT_EXPORTABLE';
  constructor() {
    super('The private key was created non-exportable in OpenBao and cannot be exported');
  }
}

export interface KeyPairIds {
  privateKeyId: string;
  publicKeyId: string;
}

export interface CertifyOptions {
  /** PEM CSR. Its subject, key and requested extensions are kept (`preserveCsrKey` must be true). */
  csr?: string;
  preserveCsrKey?: boolean;
  /** Certify an existing public key row. */
  publicKeyId?: string;
  /** Issuer certificate row; omitted for a self-signed certificate. */
  issuerCertificateId?: string;
  /** "CN=...,O=...,C=..." (RFC 2253 escaping). Not used in CSR mode. */
  subjectName?: string;
  daysValid?: number;
  /** Generated key algorithm when neither `csr` nor `publicKeyId` is given. */
  keyAlgorithm?: string;
  keySizeInBits?: number;
  /** Extensions in the `[ v3_ca ]` text syntax (see `crypto/x509-extensions.ts`). */
  x509Extensions?: string;
  tags?: string[];
}

export interface CertifyResult {
  certificateId: string;
  /** DER, hex (the format the Cosmian client returned). */
  certificateData: string;
  certificatePem: string;
  privateKeyId?: string;
  publicKeyId?: string;
}

const pemOfSpki = (key: KeyObject): string => key.export({ type: 'spki', format: 'pem' }).toString().trim();
const spkiDer = (key: KeyObject): Buffer => key.export({ type: 'spki', format: 'der' });

function nameFields(subjectName: string | undefined): NameFields {
  if (!subjectName) throw new CertificateBuildError('a subject name is required');
  const dn = parseDN(subjectName);
  return { CN: dn.CN, OU: dn.OU, O: dn.O, L: dn.L, ST: dn.ST, C: dn.C };
}

function isCaConfig(text: string | undefined): boolean {
  return !!text && /basicConstraints\s*=[^\n]*CA:TRUE/i.test(text);
}

export class X509KeyStoreService {
  constructor(private readonly store: KeyStore & { readonly mount: string; readonly caKeysExportable: boolean } = new OpenBaoKeyStore()) {}

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  private async row(id: string): Promise<KeystoreObject> {
    const [found] = await db.select().from(keystoreObjects).where(eq(keystoreObjects.id, id)).limit(1);
    if (!found) throw new KeyStoreObjectNotFoundError(id);
    return found;
  }

  private async keyRow(id: string, purpose: 'sign' | 'read' | 'export'): Promise<KeystoreObject & { ref: KeyRef; publicKey: KeyObject }> {
    const r = await this.row(id);
    if (r.objectType !== 'private_key' && r.objectType !== 'public_key') throw new KeyStoreStateError(`object ${id} is not a key`);
    if (r.state === 'pending') throw new KeyStoreStateError(`key ${id} was never completed`);
    if (r.state === 'destroyed') throw new KeyStoreStateError(`key ${id} is destroyed`);
    if (r.state === 'revoked' && purpose !== 'read') throw new KeyStoreStateError(`key ${id} is revoked`);
    if (!r.mount || !r.keyName || !r.keyVersion || !r.keyAlgorithm || !r.publicKeyPem) throw new KeyStoreStateError(`key ${id} is incomplete`);
    const ref: KeyRef = { provider: 'openbao', mount: r.mount, name: r.keyName, version: r.keyVersion, alg: toKeyAlg(r.keyAlgorithm) };
    return { ...r, ref, publicKey: createPublicKey(r.publicKeyPem) };
  }

  private async certificateRow(id: string): Promise<KeystoreObject & { certificatePem: string; parsed: ParsedCertificate }> {
    const r = await this.row(id);
    if (r.objectType !== 'certificate') throw new KeyStoreStateError(`object ${id} is not a certificate`);
    if (r.state === 'destroyed' || !r.certificatePem) throw new KeyStoreStateError(`certificate ${id} is destroyed`);
    return { ...r, certificatePem: r.certificatePem, parsed: parseCertificateDer(pemToDer(r.certificatePem, 'CERTIFICATE')) };
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  /**
   * Generate a key pair. The Transit key name is recorded (state `pending`) before the key is
   * created, so a key whose creation response was lost is still traceable to its row.
   */
  async createKeyPair(o: { keyAlgorithm?: string; sizeInBits?: number; purpose: 'ca' | 'certificate'; tags?: string[] }): Promise<KeyPairIds & { publicKey: KeyObject }> {
    const alg: KeyAlg = toKeyAlg(o.keyAlgorithm, o.sizeInBits ?? 4096);
    const exportable = o.purpose === 'ca' ? this.store.caKeysExportable : true;
    const privateKeyId = randomUUID();
    const publicKeyId = randomUUID();
    const keyName = `x509-${o.purpose === 'ca' ? 'ca' : 'leaf'}-${privateKeyId}`;
    const common = {
      provider: 'openbao' as const, state: 'pending' as const, mount: this.store.mount, keyName, keyVersion: 1, keyAlgorithm: alg,
      exportable, purpose: o.purpose, tags: JSON.stringify(o.tags ?? []),
    };
    await db.insert(keystoreObjects).values([
      { ...common, id: privateKeyId, objectType: 'private_key', publicKeyId },
      { ...common, id: publicKeyId, objectType: 'public_key', privateKeyId },
    ]);
    const { ref, publicKey } = await this.store.createKey({ name: keyName, alg, exportable });
    if (ref.version !== 1) throw new KeyStoreStateError('a new key must start at version 1');
    const now = new Date();
    for (const id of [privateKeyId, publicKeyId]) {
      await db.update(keystoreObjects).set({ state: 'active', publicKeyPem: pemOfSpki(publicKey), updatedAt: now })
        .where(and(eq(keystoreObjects.id, id), eq(keystoreObjects.state, 'pending')));
    }
    return { privateKeyId, publicKeyId, publicKey };
  }

  async getPublicKeyIdForPrivateKey(privateKeyId: string): Promise<string> {
    const r = await this.keyRow(privateKeyId, 'read');
    if (r.objectType !== 'private_key' || !r.publicKeyId) throw new KeyStoreStateError(`private key ${privateKeyId} has no public key link`);
    return r.publicKeyId;
  }

  async getPublicKeyPem(keyId: string): Promise<string> {
    return (await this.keyRow(keyId, 'read')).publicKeyPem!;
  }

  /** PKCS#8 PEM of an exportable private key, checked against the recorded public key. */
  async exportPrivateKeyPem(privateKeyId: string): Promise<string> {
    const r = await this.keyRow(privateKeyId, 'export');
    if (r.objectType !== 'private_key') throw new KeyStoreStateError(`object ${privateKeyId} is not a private key`);
    if (!r.exportable) throw new KeyNotExportableError();
    const pem = await this.store.exportPrivateKeyPkcs8(r.ref);
    if (!spkiDer(createPublicKey(createPrivateKey(pem))).equals(spkiDer(r.publicKey))) {
      throw new KeyStoreStateError('the exported key does not match the recorded public key');
    }
    return pem;
  }

  /**
   * Sign `data` with a private key row (CRLs). The signature is verified with the recorded
   * public key before it is returned.
   */
  async signData(privateKeyId: string, data: Buffer, hash: SignHash): Promise<Buffer> {
    const r = await this.keyRow(privateKeyId, 'sign');
    if (r.objectType !== 'private_key') throw new KeyStoreStateError(`object ${privateKeyId} is not a private key`);
    const signature = await this.store.sign(r.ref, data, hash);
    if (!nodeVerify(hash, data, r.publicKey, signature)) throw new KeyStoreStateError('the key store signature does not verify');
    return signature;
  }

  // ---------------------------------------------------------------------------
  // Certificates
  // ---------------------------------------------------------------------------

  async getCertificatePem(certificateId: string): Promise<string> {
    return (await this.certificateRow(certificateId)).certificatePem;
  }

  async getCertificatePrivateKeyId(certificateId: string): Promise<string> {
    const r = await this.certificateRow(certificateId);
    if (!r.privateKeyId) throw new KeyStoreStateError(`certificate ${certificateId} has no private key in the key store`);
    return r.privateKeyId;
  }

  /**
   * Build a certificate and sign it in Transit. Modes, as Cosmian `Certify` had them:
   * - `csr` (+ `preserveCsrKey`): certify the CSR key and subject, keep its extensions;
   * - `publicKeyId`: certify an existing key pair with `subjectName`;
   * - neither: generate a key pair (`keyAlgorithm`) and certify it with `subjectName`.
   * Without `issuerCertificateId` the certificate is self-signed.
   */
  async certify(o: CertifyOptions): Promise<CertifyResult> {
    if (o.csr && o.publicKeyId) throw new CertificateBuildError('give a CSR or a public key, not both');
    if (o.csr && o.preserveCsrKey !== true) throw new CertificateBuildError('CSR signing keeps the CSR key: preserveCsrKey must be true');

    // Issuer: its certificate, its private key row, and its public key (they must agree).
    let issuer: { certId: string; parsed: ParsedCertificate; key: KeystoreObject & { ref: KeyRef; publicKey: KeyObject } } | undefined;
    if (o.issuerCertificateId) {
      const cert = await this.certificateRow(o.issuerCertificateId);
      if (!cert.privateKeyId) throw new KeyStoreStateError('the issuer certificate has no private key in the key store');
      if (!cert.parsed.isCa) throw new CertificateBuildError('the issuer certificate is not a CA certificate');
      const key = await this.keyRow(cert.privateKeyId, 'sign');
      if (!cert.parsed.spki.raw.equals(spkiDer(key.publicKey))) throw new KeyStoreStateError('the issuer certificate and its key do not match');
      issuer = { certId: o.issuerCertificateId, parsed: cert.parsed, key };
    } else if (o.csr) {
      throw new CertificateBuildError('a CSR needs an issuer certificate');
    }

    // Subject: name, public key, links and the extensions it brings.
    let subjectName: Buffer;
    let spki: Buffer;
    let subjectPublicKey: KeyObject;
    let subjectKey: (KeystoreObject & { ref: KeyRef; publicKey: KeyObject }) | undefined;
    let links: { privateKeyId?: string; publicKeyId?: string } = {};
    let requested: EncodedExtension[] = [];
    if (o.csr) {
      const csr = parseCsr(pemToDer(o.csr, /-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----([\s\S]+?)-----END (?:NEW )?CERTIFICATE REQUEST-----/));
      subjectName = csr.subjectName;
      spki = csr.spki.raw;
      subjectPublicKey = csr.spki.key;
      requested = csr.extensions;
    } else {
      subjectName = encodeName(nameFields(o.subjectName));
      if (o.publicKeyId) {
        const pub = await this.keyRow(o.publicKeyId, 'read');
        if (pub.state !== 'active') throw new KeyStoreStateError(`key ${o.publicKeyId} is not active`);
        links = { publicKeyId: pub.objectType === 'public_key' ? pub.id : pub.publicKeyId ?? undefined, privateKeyId: pub.objectType === 'private_key' ? pub.id : pub.privateKeyId ?? undefined };
        subjectPublicKey = pub.publicKey;
        if (!issuer) {
          if (!links.privateKeyId) throw new KeyStoreStateError('a self-signed certificate needs the private key');
          subjectKey = await this.keyRow(links.privateKeyId, 'sign');
        }
      } else {
        const purpose = isCaConfig(o.x509Extensions) ? 'ca' : 'certificate';
        const created = await this.createKeyPair({ keyAlgorithm: o.keyAlgorithm, sizeInBits: o.keySizeInBits, purpose, tags: o.tags });
        links = { privateKeyId: created.privateKeyId, publicKeyId: created.publicKeyId };
        subjectPublicKey = created.publicKey;
        if (!issuer) subjectKey = await this.keyRow(created.privateKeyId, 'sign');
      }
      spki = spkiDer(subjectPublicKey);
    }

    const signingKey = issuer?.key ?? subjectKey!;
    const subjectBits = spkiBits(spki);
    const issuerKeyId = issuer ? issuer.parsed.keyId : keyIdentifier(subjectBits);
    const extCtx = { subjectPublicKey: subjectBits, issuerKeyId };
    const configured = buildExtensionsFromConfig(o.x509Extensions, extCtx);
    let extensions = mergeExtensions(requested, configured);
    // RFC 5280 §4.2.1.1: every certificate that is not self-signed carries the issuer key id
    // (OpenSSL `verify -x509_strict` requires it). Added when the caller did not ask for it.
    if (issuer && !extensions.some((e) => e.oid === OID.authorityKeyIdentifier)) {
      extensions = [...extensions, ...buildExtensionsFromConfig('authorityKeyIdentifier=keyid', extCtx)];
    }
    const { notBefore, notAfter } = validityWindow(o.daysValid, issuer?.parsed.notAfter);
    const alg = signatureAlgorithmFor(signingKey.publicKey);

    const der = await buildCertificate({
      subjectName,
      spki,
      issuerName: issuer ? issuer.parsed.subjectName : subjectName,
      issuerPublicKey: signingKey.publicKey,
      serial: randomSerial(),
      notBefore,
      notAfter,
      extensions,
      signer: (tbs) => this.store.sign(signingKey.ref, tbs, alg.hash),
    });
    const certificatePem = derToPem(der, 'CERTIFICATE');

    const certificateId = randomUUID();
    await db.insert(keystoreObjects).values({
      id: certificateId,
      objectType: 'certificate',
      provider: 'openbao',
      state: 'active',
      certificatePem,
      issuerCertificateId: issuer?.certId ?? certificateId,
      privateKeyId: links.privateKeyId ?? null,
      publicKeyId: links.publicKeyId ?? null,
      tags: JSON.stringify(o.tags ?? []),
    });
    return { certificateId, certificateData: der.toString('hex'), certificatePem, ...links };
  }

  /**
   * External CSR issuance (Kubernetes issuer, SCEP gateway, SCEP RA certificate): the CSR's
   * subject, public key and requested extensions, signed by the issuer CA in Transit.
   */
  async issueFromCsr(o: { csrPem: string; issuerCertificateId: string; daysValid: number; x509Extensions?: string; tags?: string[] }): Promise<CertifyResult> {
    return this.certify({ csr: o.csrPem, preserveCsrKey: true, issuerCertificateId: o.issuerCertificateId, daysValid: o.daysValid, x509Extensions: o.x509Extensions, tags: o.tags });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Refuse new signatures with a key (Cosmian `Revoke`). Certificates: no effect on the PEM. */
  async revoke(id: string): Promise<void> {
    const r = await this.row(id);
    if (r.state === 'destroyed' || r.state === 'revoked') return;
    await this.setState(r, 'revoked');
  }

  /**
   * Destroy an object. For a key, the Transit key is deleted first, then both key rows are
   * marked destroyed. A certificate row is marked destroyed (no Transit call).
   */
  async destroy(id: string): Promise<void> {
    const r = await this.row(id);
    if (r.state === 'destroyed') return;
    if (r.objectType !== 'certificate' && r.mount && r.keyName && r.keyVersion && r.keyAlgorithm) {
      await this.store.destroy({ provider: 'openbao', mount: r.mount, name: r.keyName, version: r.keyVersion, alg: toKeyAlg(r.keyAlgorithm) });
    }
    await this.setState(r, 'destroyed');
  }

  private async setState(r: KeystoreObject, state: 'revoked' | 'destroyed'): Promise<void> {
    const now = new Date();
    const values = state === 'destroyed' ? { state, updatedAt: now, destroyedAt: now } : { state, updatedAt: now };
    if (r.objectType === 'certificate' || !r.mount || !r.keyName) {
      await db.update(keystoreObjects).set(values).where(eq(keystoreObjects.id, r.id));
      return;
    }
    // Both rows of the key pair share the Transit key.
    await db.update(keystoreObjects).set(values).where(and(eq(keystoreObjects.mount, r.mount), eq(keystoreObjects.keyName, r.keyName)));
  }

  async status(): Promise<KeyStoreState> {
    return this.store.status();
  }
}

/** Contents of the subjectPublicKey BIT STRING of a DER SubjectPublicKeyInfo. */
function spkiBits(spki: Buffer): Buffer {
  return bitStringBytes(child(parseDer(spki), 1, TAG.BIT_STRING));
}

let instance: X509KeyStoreService | undefined;
export function getX509KeyStore(): X509KeyStoreService {
  instance ??= new X509KeyStoreService();
  return instance;
}
/** Tests only. */
export function setX509KeyStoreForTests(service: X509KeyStoreService | undefined): void {
  instance = service;
}

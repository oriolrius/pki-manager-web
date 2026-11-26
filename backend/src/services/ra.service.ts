import forge from 'node-forge';
import { randomUUID, X509Certificate, createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { integrationRAs, certificateAuthorities, certificates } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import type { KMIPElement } from '../kms/types.js';
import { parseCertificate } from '../crypto/x509.js';
import { logger } from '../lib/logger.js';
import {
  OpenBaoConfigError, OpenBaoError, OpenBaoResponseError, defaultRAKeyProvider, getOpenBaoRATransit, type RAKeyProvider,
} from '../openbao/ra-transit.js';

type Identity = { id: string; caId: string; kind: string };
type Previous = { id: string; certificatePem: string };
type Binding = typeof integrationRAs.$inferSelect;
const text = (tag: string, value: string): KMIPElement => ({ tag, type: 'TextString', value });
const enumeration = (tag: string, value: string): KMIPElement => ({ tag, type: 'Enumeration', value });
function value(node: KMIPElement, tag: string): string {
  if (node.tag === tag && typeof node.value === 'string') return node.value;
  if (Array.isArray(node.value)) for (const child of node.value) {
    try { return value(child as KMIPElement, tag); } catch { /* try sibling */ }
  }
  throw new Error('KMS response missing required RA field');
}
function publicState(binding: Binding) {
  if (!binding.certificatePem) throw new RAError(409, 'RA provisioning is incomplete');
  return {
    certificatePem: binding.certificatePem,
    previousCertificatesPem: (JSON.parse(binding.previous) as Previous[]).map(p => p.certificatePem),
  };
}
export class RAError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

/** CMS session key lengths of the content ciphers that the SCEP gateway accepts. */
export const SESSION_KEY_LENGTHS = [16, 24, 32] as const;
export type SessionKeyLength = (typeof SESSION_KEY_LENGTHS)[number];
export function isSessionKeyLength(value: unknown): value is SessionKeyLength {
  return typeof value === 'number' && (SESSION_KEY_LENGTHS as readonly number[]).includes(value);
}
// One error for every decryption failure: KMS errors and length mismatches look the same.
const decryptionFailed = () => new RAError(502, 'RA decryption failed');

const RA_SUBJECT = 'CN=SCEP Registration Authority';
const RA_EXTENSIONS = '[v3_ca]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n';

/** Filled by the service so the route can write the provider in its audit row. */
export interface RAOperationContext { provider?: RAKeyProvider }

/** Maps an OpenBao failure to a generic RA error; the detail goes to the server log only. */
function openBaoFailure(error: unknown, operation: string): RAError {
  if (error instanceof RAError) return error;
  if (error instanceof OpenBaoConfigError) {
    logger.error({ operation, reason: error.message }, 'OpenBao RA provider is not configured');
    return new RAError(503, 'RA key provider is not configured');
  }
  if (error instanceof OpenBaoError) logger.warn({ operation, status: error.status, path: error.path, detail: error.detail }, 'OpenBao RA request failed');
  else if (error instanceof OpenBaoResponseError) logger.warn({ operation, reason: error.message }, 'OpenBao RA response rejected');
  else logger.warn({ operation, err: String(error) }, 'OpenBao RA operation failed');
  return new RAError(502, 'RA key operation failed');
}

/** The OpenBao binding fields; fail closed when the row is not complete. */
function openBaoKey(binding: Binding): { name: string; version: number } {
  if (binding.keyProvider !== 'openbao' || !binding.keyId || !Number.isInteger(binding.keyVersion) || (binding.keyVersion as number) < 1) {
    throw new RAError(409, 'Incomplete RA key binding; operator recovery required');
  }
  return { name: binding.keyId, version: binding.keyVersion as number };
}

/**
 * PKCS#10 for the RA public key, signed in OpenBao (proof of possession), so the
 * Cosmian issuing CA can certify it in CSR mode. node-forge builds the request;
 * Node crypto checks the signature; no OpenSSL CLI.
 */
async function openBaoRACSR(key: { name: string; version: number }, publicKey: KeyObject): Promise<string> {
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(spki.toString('binary'))));
  csr.setSubject([{ name: 'commonName', value: 'SCEP Registration Authority' }]);
  csr.signatureOid = forge.pki.oids.sha256WithRSAEncryption;
  // Exists in node-forge (lib/x509.js) but is missing from @types/node-forge.
  const info = (forge.pki as unknown as { getCertificationRequestInfo(c: forge.pki.CertificateSigningRequest): forge.asn1.Asn1 }).getCertificationRequestInfo(csr);
  const digest = createHash('sha256').update(Buffer.from(forge.asn1.toDer(info).getBytes(), 'binary')).digest();
  const signature = await getOpenBaoRATransit().signDigest(key.name, key.version, digest, publicKey);
  (csr as unknown as { certificationRequestInfo: forge.asn1.Asn1 }).certificationRequestInfo = info;
  csr.signature = signature.toString('binary');
  const pem = forge.pki.certificationRequestToPem(csr);
  if (!forge.pki.certificationRequestFromPem(pem).verify()) throw new OpenBaoResponseError('RA CSR signature does not verify');
  return pem;
}

export class RAService {
  private async authority(identity: Identity) {
    if (identity.kind !== 'scep') throw new RAError(403, 'RA operations require a SCEP integration');
    const [ca] = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, identity.caId)).limit(1);
    const now = new Date();
    if (!ca || ca.status !== 'active' || ca.notBefore > now || ca.notAfter <= now) throw new RAError(409, 'Issuing CA is not active');
    return ca;
  }
  private async binding(identity: Identity) {
    await this.authority(identity);
    const [binding] = await db.select().from(integrationRAs).where(eq(integrationRAs.integrationId, identity.id)).limit(1);
    if (!binding) throw new RAError(404, 'RA is not provisioned');
    if (binding.caId !== identity.caId) throw new RAError(403, 'Integration CA binding changed');
    return binding;
  }
  async state(identity: Identity, context: RAOperationContext = {}) {
    const binding = await this.binding(identity);
    context.provider = binding.keyProvider;
    return publicState(binding);
  }

  async provision(identity: Identity, context: RAOperationContext = {}) {
    await this.authority(identity);
    const lease = randomUUID();
    const inserted = await db.insert(integrationRAs).values({ integrationId: identity.id, caId: identity.caId, lease, leaseUntil: new Date(Date.now() + 15 * 60_000) }).onConflictDoNothing().returning();
    let binding: Binding;
    if (inserted.length) binding = inserted[0];
    else {
      const existing = await this.binding(identity);
      context.provider = existing.keyProvider;
      if (existing.certificatePem) return publicState(existing);
      const claimed = await db.update(integrationRAs).set({ lease, leaseUntil: new Date(Date.now() + 15 * 60_000) }).where(and(
        eq(integrationRAs.integrationId, identity.id), isNull(integrationRAs.certificatePem),
        or(isNull(integrationRAs.lease), lt(integrationRAs.leaseUntil, new Date())),
      )).returning();
      if (!claimed.length) throw new RAError(409, 'RA provisioning lease is still active; retry after expiry');
      binding = claimed[0];
    }
    {
      const kms = getKMSService();
      if (!binding.keyId && !binding.publicKeyId) {
        // The provider is chosen once, when the first key id is recorded. A
        // binding never changes provider afterwards.
        let provider: RAKeyProvider;
        try { provider = defaultRAKeyProvider(); } catch (error) { throw openBaoFailure(error, 'provision'); }
        if (provider === 'openbao') {
          // Record the generated name before the key exists: a retry after a lost
          // response then reads the same key instead of creating an orphan.
          const keyId = `scep-ra-${randomUUID()}`;
          const recorded = db.update(integrationRAs).set({ keyProvider: 'openbao', keyId, publicKeyId: null, keyVersion: 1 })
            .where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease), isNull(integrationRAs.keyId))).run();
          if (recorded.changes !== 1) throw new RAError(409, 'RA lease lost');
          binding = { ...binding, keyProvider: 'openbao', keyId, publicKeyId: null, keyVersion: 1 };
        }
      }
      context.provider = binding.keyProvider;
      if (binding.keyProvider === 'openbao') {
        const key = openBaoKey(binding);
        try { await getOpenBaoRATransit().ensureKey(key.name, key.version); } catch (error) { throw openBaoFailure(error, 'provision'); }
      } else if (!binding.keyId && !binding.publicKeyId) {
        const response = await kms.performRAOperation('CreateKeyPair', [
          { tag: 'CommonAttributes', value: [enumeration('CryptographicAlgorithm', 'RSA'), { tag: 'CryptographicLength', type: 'Integer', value: 3072 }] },
          { tag: 'PrivateKeyAttributes', value: [{ tag: 'CryptographicUsageMask', type: 'Integer', value: 9 }, { tag: 'Sensitive', type: 'Boolean', value: true }] },
          { tag: 'PublicKeyAttributes', value: [{ tag: 'CryptographicUsageMask', type: 'Integer', value: 6 }] },
        ]);
        const keyId = value(response, 'PrivateKeyUniqueIdentifier');
        const publicKeyId = value(response, 'PublicKeyUniqueIdentifier');
        await db.update(integrationRAs).set({ keyProvider: 'cosmian', keyId, publicKeyId }).where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease)));
        binding = { ...binding, keyProvider: 'cosmian', keyId, publicKeyId };
        context.provider = 'cosmian';
      }
      if (binding.keyProvider !== 'openbao') {
        if (!binding.keyId || !binding.publicKeyId) throw new RAError(409, 'Incomplete RA key pair; operator recovery required');
        for (const id of [binding.keyId, binding.publicKeyId]) {
          const state = value(await kms.performRAOperation('GetAttributes', [text('UniqueIdentifier', id)]), 'State');
          if (state === 'PreActive') await kms.performRAOperation('Activate', [text('UniqueIdentifier', id)]);
          else if (state !== 'Active') throw new RAError(409, 'RA key is no longer usable');
        }
      }
      const result = await this.issue(identity, binding, lease);
      // On failure retain the lease until expiry. Retries then reuse recorded keys;
      // an unrecorded allocation can be reconciled by its integration audit trail.
      await db.update(integrationRAs).set({ lease: null, leaseUntil: null }).where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease)));
      return result;
    }
  }

  private async active(identity: Identity) {
    const binding = await this.binding(identity);
    const [cert] = await db.select().from(certificates).where(and(eq(certificates.id, binding.certificateId ?? ''), eq(certificates.integrationId, identity.id), eq(certificates.caId, identity.caId))).limit(1);
    if (!binding.keyId || !cert || cert.status !== 'active' || cert.notBefore > new Date() || cert.notAfter <= new Date()) throw new RAError(409, 'RA is not active');
    return binding;
  }

  async renew(identity: Identity, context: RAOperationContext = {}) {
    const binding = await this.binding(identity);
    context.provider = binding.keyProvider;
    if (!binding.certificatePem || !binding.keyId) throw new RAError(409, 'RA is not provisioned');
    const [cert] = await db.select().from(certificates).where(and(eq(certificates.id, binding.certificateId ?? ''), eq(certificates.integrationId, identity.id), eq(certificates.caId, identity.caId))).limit(1);
    if (!cert || cert.status !== 'active') throw new RAError(409, 'RA is revoked or not owned');
    if (Date.now() < cert.notAfter.getTime() - (cert.notAfter.getTime() - cert.notBefore.getTime()) / 3) return publicState(binding);
    const lease = randomUUID();
    const claimed = await db.update(integrationRAs).set({ lease, leaseUntil: new Date(Date.now() + 15 * 60_000) }).where(and(
      eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.certificateId, cert.id), or(isNull(integrationRAs.lease), lt(integrationRAs.leaseUntil, new Date())),
    )).returning();
    if (!claimed.length) throw new RAError(409, 'RA renewal already in progress');
    try { return await this.issue(identity, claimed[0], lease); }
    finally { await db.update(integrationRAs).set({ lease: null, leaseUntil: null }).where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease))); }
  }

  private async issue(identity: Identity, binding: Binding, lease: string) {
    const ca = await this.authority(identity);
    const kms = getKMSService();
    const tags = ['scep-ra', `integration:${identity.id}`, `ca:${ca.id}`];
    const daysValid = Math.min(90, Math.floor((ca.notAfter.getTime() - Date.now()) / 86400_000));
    let expected: KeyObject;
    let csr: string | undefined;
    if (binding.keyProvider === 'openbao') {
      // The RA key is in OpenBao; the issuing CA key is still in Cosmian. OpenBao
      // signs a CSR for the fixed key version, Cosmian certifies the CSR key.
      const key = openBaoKey(binding);
      try {
        const publicKey = await getOpenBaoRATransit().readKey(key.name, key.version);
        if (!publicKey) throw new OpenBaoResponseError('RA key does not exist');
        expected = publicKey;
        if (daysValid >= 1) csr = await openBaoRACSR(key, publicKey);
      } catch (error) { throw openBaoFailure(error, 'issue'); }
    } else {
      const publicResponse = await kms.performRAOperation('Get', [text('UniqueIdentifier', binding.publicKeyId!), enumeration('KeyFormatType', 'PKCS8'), enumeration('KeyWrapType', 'AsRegistered')]);
      expected = createPublicKey({ key: Buffer.from(value(publicResponse, 'KeyMaterial'), 'hex'), format: 'der', type: 'spki' });
    }
    if (daysValid < 1) throw new RAError(409, 'Issuing CA must have at least one day remaining');
    const id = randomUUID();
    const cert = csr
      ? await kms.signCertificate({ csr, preserveCsrKey: true, issuerCertificateId: ca.kmsCertificateId, daysValid, entityId: id, tags, x509Extensions: RA_EXTENSIONS })
      : await kms.signCertificate({ publicKeyId: binding.publicKeyId!, issuerCertificateId: ca.kmsCertificateId,
        subjectName: RA_SUBJECT, issuerName: ca.subjectDn, daysValid, keyAlgorithm: 'RSA-3072', entityId: id, tags, x509Extensions: RA_EXTENSIONS,
      });
    const pem = await kms.getCertificate(cert.certificateId, id);
    const parsed = new X509Certificate(pem);
    const caPem = await kms.getCertificate(ca.kmsCertificateId, ca.id);
    if (parsed.ca || parsed.subject !== 'CN=SCEP Registration Authority' || !parsed.verify(new X509Certificate(caPem).publicKey)
      || !parsed.publicKey.export({ format: 'der', type: 'spki' }).equals(expected.export({ format: 'der', type: 'spki' }))) throw new RAError(502, 'KMS returned an invalid RA certificate');
    const attributes = forge.pki.certificateFromPem(pem);
    const usage = attributes.getExtension('keyUsage') as { digitalSignature?: boolean; keyEncipherment?: boolean; keyCertSign?: boolean; cRLSign?: boolean } | null;
    if (!usage?.digitalSignature || !usage.keyEncipherment || usage.keyCertSign || usage.cRLSign || parsed.keyUsage !== undefined) throw new RAError(502, 'Invalid RA key usage');
    const metadata = parseCertificate(pem, 'PEM');
    if (metadata.validity.notBefore > new Date() || metadata.validity.notAfter <= new Date() || metadata.validity.notAfter > ca.notAfter) throw new RAError(409, 'RA validity is outside issuing CA validity');
    if (binding.certificatePem && new X509Certificate(binding.certificatePem).serialNumber === parsed.serialNumber) throw new RAError(409, 'KMS reused the RA serial; upgrade to a KMS version with fresh certificate serials (tested: 5.28.0)');
    if (binding.certificatePem && metadata.validity.notAfter <= new Date(new X509Certificate(binding.certificatePem).validTo)) throw new RAError(409, 'RA renewal does not extend validity');
    const previous = (JSON.parse(binding.previous) as Previous[]).filter(p => new Date(new X509Certificate(p.certificatePem).validTo) > new Date());
    if (binding.certificatePem && binding.certificateId) previous.unshift({ id: binding.certificateId, certificatePem: binding.certificatePem });
    const updated = { certificateId: id, certificatePem: pem, previous: JSON.stringify(previous) };
    // Publish the certificate record and its binding atomically. Only the lease
    // owner can change the active RA; KMS key IDs never cross the HTTP boundary.
    db.transaction(tx => {
      const changed = tx.update(integrationRAs).set(updated).where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease))).run();
      if (changed.changes !== 1) throw new RAError(409, 'RA lease lost');
      // An OpenBao key is not a Cosmian object: kmsKeyId stays NULL, so certificate
      // delete/renew/export code never sends the Transit key name to Cosmian.
      tx.insert(certificates).values({ id, caId: ca.id, kmsCertificateId: cert.certificateId, kmsKeyId: binding.keyProvider === 'openbao' ? null : binding.keyId,
        subjectDn: 'CN=SCEP Registration Authority', serialNumber: metadata.serialNumber, certificateType: 'client',
        notBefore: metadata.validity.notBefore, notAfter: metadata.validity.notAfter, certificatePem: pem,
        status: 'active', sourceType: 'scep', integrationId: identity.id, requestUid: `scep-ra:${id}`,
      }).run();
    });
    return publicState({ ...binding, ...updated });
  }

  async sign(identity: Identity, digest: Buffer, context: RAOperationContext = {}) {
    const binding = await this.active(identity);
    context.provider = binding.keyProvider;
    if (digest.length !== 32) throw new RAError(400, 'SHA-256 digest required');
    if (binding.keyProvider === 'openbao') {
      const key = openBaoKey(binding);
      if (!binding.certificatePem) throw new RAError(409, 'RA is not active');
      // The current RA certificate fixes the public key the signature must verify with.
      const publicKey = new X509Certificate(binding.certificatePem).publicKey;
      try { return await getOpenBaoRATransit().signDigest(key.name, key.version, digest, publicKey); }
      catch (error) { throw openBaoFailure(error, 'sign'); }
    }
    const result = await getKMSService().performRAOperation('Sign', [text('UniqueIdentifier', binding.keyId!),
      { tag: 'CryptographicParameters', value: [enumeration('CryptographicAlgorithm', 'RSA'), enumeration('HashingAlgorithm', 'SHA256'), enumeration('PaddingMethod', 'PKCS1v15'), enumeration('DigitalSignatureAlgorithm', 'SHA256WithRSAEncryption')] },
      { tag: 'DigestedData', type: 'ByteString', value: digest.toString('hex') },
    ]);
    return Buffer.from(value(result, 'SignatureData'), 'hex');
  }
  /**
   * Unwraps a CMS session key with the RA key.
   *
   * `sessionKeyLength` is the key length of the envelope's content cipher (16, 24
   * or 32 bytes), which the SCEP gateway reads from the verified envelope. When
   * it is given, the plaintext must have exactly that length. When it is omitted
   * (older gateways), any of 16, 24 or 32 bytes is accepted, as before.
   *
   * Every failure after the input checks (KMS error, missing response field,
   * wrong plaintext length) gives the same error, so the caller cannot tell a
   * padding failure from a length mismatch.
   *
   * An OpenBao-bound RA requires `sessionKeyLength`: the fork operation takes the
   * expected length and never reports a padding failure (it returns a
   * deterministic fallback key, and the CMS content decryption then fails).
   */
  async decrypt(identity: Identity, ciphertext: Buffer, sessionKeyLength?: number, context: RAOperationContext = {}) {
    const binding = await this.active(identity);
    context.provider = binding.keyProvider;
    if (ciphertext.length !== 384) throw new RAError(400, 'RSA-3072 ciphertext required');
    if (sessionKeyLength !== undefined && !isSessionKeyLength(sessionKeyLength)) throw new RAError(400, 'sessionKeyLength must be 16, 24 or 32');
    if (binding.keyProvider === 'openbao') {
      if (sessionKeyLength === undefined) throw new RAError(400, 'sessionKeyLength is required for this RA');
      const key = openBaoKey(binding);
      try { return await getOpenBaoRATransit().unwrapSessionKey(key.name, key.version, ciphertext, sessionKeyLength); }
      catch (error) {
        if (error instanceof OpenBaoConfigError) throw openBaoFailure(error, 'decrypt');
        openBaoFailure(error, 'decrypt'); // log only
        throw decryptionFailed();
      }
    }
    let plaintext: Buffer;
    try {
      const result = await getKMSService().performRAOperation('Decrypt', [text('UniqueIdentifier', binding.keyId!),
        { tag: 'CryptographicParameters', value: [enumeration('CryptographicAlgorithm', 'RSA'), enumeration('PaddingMethod', 'PKCS1v15')] },
        { tag: 'Data', type: 'ByteString', value: ciphertext.toString('hex') },
      ]);
      plaintext = Buffer.from(value(result, 'Data'), 'hex');
    } catch {
      throw decryptionFailed();
    }
    const valid = sessionKeyLength === undefined ? isSessionKeyLength(plaintext.length) : plaintext.length === sessionKeyLength;
    if (!valid) {
      plaintext.fill(0);
      throw decryptionFailed();
    }
    return plaintext;
  }
}

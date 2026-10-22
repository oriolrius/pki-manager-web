import forge from 'node-forge';
import { randomUUID, X509Certificate, createPublicKey } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { integrationRAs, certificateAuthorities, certificates } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import type { KMIPElement } from '../kms/types.js';
import { parseCertificate } from '../crypto/x509.js';

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
  async state(identity: Identity) { return publicState(await this.binding(identity)); }

  async provision(identity: Identity) {
    await this.authority(identity);
    const lease = randomUUID();
    const inserted = await db.insert(integrationRAs).values({ integrationId: identity.id, caId: identity.caId, lease, leaseUntil: new Date(Date.now() + 15 * 60_000) }).onConflictDoNothing().returning();
    let binding: Binding;
    if (inserted.length) binding = inserted[0];
    else {
      const existing = await this.binding(identity);
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
        const response = await kms.performRAOperation('CreateKeyPair', [
          { tag: 'CommonAttributes', value: [enumeration('CryptographicAlgorithm', 'RSA'), { tag: 'CryptographicLength', type: 'Integer', value: 3072 }] },
          { tag: 'PrivateKeyAttributes', value: [{ tag: 'CryptographicUsageMask', type: 'Integer', value: 9 }, { tag: 'Sensitive', type: 'Boolean', value: true }] },
          { tag: 'PublicKeyAttributes', value: [{ tag: 'CryptographicUsageMask', type: 'Integer', value: 6 }] },
        ]);
        const keyId = value(response, 'PrivateKeyUniqueIdentifier');
        const publicKeyId = value(response, 'PublicKeyUniqueIdentifier');
        await db.update(integrationRAs).set({ keyId, publicKeyId }).where(and(eq(integrationRAs.integrationId, identity.id), eq(integrationRAs.lease, lease)));
        binding = { ...binding, keyId, publicKeyId };
      }
      if (!binding.keyId || !binding.publicKeyId) throw new RAError(409, 'Incomplete RA key pair; operator recovery required');
      for (const id of [binding.keyId, binding.publicKeyId]) await kms.performRAOperation('Activate', [text('UniqueIdentifier', id)]);
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

  async renew(identity: Identity) {
    const binding = await this.binding(identity);
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
    const publicResponse = await kms.performRAOperation('Get', [text('UniqueIdentifier', binding.publicKeyId!), enumeration('KeyFormatType', 'PKCS8'), enumeration('KeyWrapType', 'AsRegistered')]);
    const expected = createPublicKey({ key: Buffer.from(value(publicResponse, 'KeyMaterial'), 'hex'), format: 'der', type: 'spki' });
    const daysValid = Math.min(90, Math.floor((ca.notAfter.getTime() - Date.now()) / 86400_000));
    if (daysValid < 1) throw new RAError(409, 'Issuing CA must have at least one day remaining');
    const id = randomUUID();
    const cert = await kms.signCertificate({ publicKeyId: binding.publicKeyId!, issuerCertificateId: ca.kmsCertificateId,
      subjectName: 'CN=SCEP Registration Authority', issuerName: ca.subjectDn, daysValid, keyAlgorithm: 'RSA-3072', entityId: id,
      tags: ['scep-ra', `integration:${identity.id}`, `ca:${ca.id}`],
      x509Extensions: '[v3_ca]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n',
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
      tx.insert(certificates).values({ id, caId: ca.id, kmsCertificateId: cert.certificateId, kmsKeyId: binding.keyId,
        subjectDn: 'CN=SCEP Registration Authority', serialNumber: metadata.serialNumber, certificateType: 'client',
        notBefore: metadata.validity.notBefore, notAfter: metadata.validity.notAfter, certificatePem: pem,
        status: 'active', sourceType: 'scep', integrationId: identity.id, requestUid: `scep-ra:${id}`,
      }).run();
    });
    return publicState({ ...binding, ...updated });
  }

  async sign(identity: Identity, digest: Buffer) {
    const binding = await this.active(identity);
    if (digest.length !== 32) throw new RAError(400, 'SHA-256 digest required');
    const result = await getKMSService().performRAOperation('Sign', [text('UniqueIdentifier', binding.keyId!),
      { tag: 'CryptographicParameters', value: [enumeration('CryptographicAlgorithm', 'RSA'), enumeration('HashingAlgorithm', 'SHA256'), enumeration('PaddingMethod', 'PKCS1v15'), enumeration('DigitalSignatureAlgorithm', 'SHA256WithRSAEncryption')] },
      { tag: 'DigestedData', type: 'ByteString', value: digest.toString('hex') },
    ]);
    return Buffer.from(value(result, 'SignatureData'), 'hex');
  }
  async decrypt(identity: Identity, ciphertext: Buffer) {
    const binding = await this.active(identity);
    if (ciphertext.length !== 384) throw new RAError(400, 'RSA-3072 ciphertext required');
    const result = await getKMSService().performRAOperation('Decrypt', [text('UniqueIdentifier', binding.keyId!),
      { tag: 'CryptographicParameters', value: [enumeration('CryptographicAlgorithm', 'RSA'), enumeration('PaddingMethod', 'PKCS1v15')] },
      { tag: 'Data', type: 'ByteString', value: ciphertext.toString('hex') },
    ]);
    const plaintext = Buffer.from(value(result, 'Data'), 'hex');
    if (![16, 24, 32].includes(plaintext.length)) throw new RAError(400, 'Invalid CMS AES key');
    return plaintext;
  }
}

/**
 * Key service used by the X.509 services and routes (CA, certificates, bulk, CSR signing,
 * CRL, downloads).
 *
 * Since the decision-018 cutover the runtime key store is OpenBao Transit; there is no
 * Cosmian KMS path. The class keeps the method names and result shapes of the former Cosmian
 * client, so call sites did not change:
 *
 * - ids are key store object ids (`keystore_objects`), stored in the `kms_*` columns;
 * - `signCertificate` builds the certificate locally and signs it in Transit;
 * - `getPrivateKey` exports only keys that were created exportable;
 * - every operation writes a `kms.*` audit row (success and failure) with `provider: openbao`.
 *
 * SSH CA keys (`services/ssh-ca-key.ts`) and SCEP RA keys (`openbao/ra-transit.ts`) have
 * their own Transit clients.
 */
import { randomUUID } from 'crypto';
import type { KeyPairIds, CertificateInfo } from './types.js';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { getX509KeyStore, type X509KeyStoreService } from '../keystore/x509-store.js';
import type { KeyStoreState, SignHash } from '../keystore/types.js';
import { OpenBaoTransitConfigError } from '../openbao/x509-transit.js';

export interface KMSServiceOptions {
  enableAuditLog?: boolean;
  /** Tests: a key store service with a stub key store. */
  store?: X509KeyStoreService;
}

export class KMSService {
  private readonly enableAuditLog: boolean;
  private readonly injected?: X509KeyStoreService;

  constructor(options: KMSServiceOptions = {}) {
    this.enableAuditLog = options.enableAuditLog !== false;
    this.injected = options.store;
  }

  private get store(): X509KeyStoreService {
    return this.injected ?? getX509KeyStore();
  }

  private async logAudit(
    operation: string,
    entityType: string,
    entityId: string | null,
    status: 'success' | 'failure',
    details: Record<string, unknown>,
    kmsOperationId?: string,
  ): Promise<void> {
    if (!this.enableAuditLog) return;
    try {
      await db.insert(auditLog).values({
        id: randomUUID(),
        operation,
        entityType,
        entityId,
        status,
        details: JSON.stringify({ provider: 'openbao', ...details }),
        kmsOperationId,
        ipAddress: null,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to write audit log');
    }
  }

  /** Runs `fn` and writes one audit row for its outcome. */
  private async audited<T>(
    operation: string,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown>,
    fn: () => Promise<T>,
    successDetails?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const operationId = randomUUID();
    try {
      const result = await fn();
      await this.logAudit(operation, entityType, entityId, 'success', { ...details, ...successDetails?.(result) }, operationId);
      return result;
    } catch (error) {
      await this.logAudit(operation, entityType, entityId, 'failure', { ...details, error: String(error) }, operationId);
      throw error;
    }
  }

  /** True when OpenBao is reachable, unsealed and accepts the token. */
  async testConnection(): Promise<boolean> {
    return this.audited('kms.test_connection', 'kms', null, {}, async () => (await this.store.status()) === 'ready', (result) => ({ result }));
  }

  /** Key store state for operator diagnostics. */
  async status() {
    return this.store.status();
  }

  /**
   * Operator diagnostics of the X.509 key store. `configured: false` when the OpenBao settings
   * are missing or invalid (the reason is in the server log). It writes no audit row: it is a
   * read-only check that monitoring can call often.
   */
  async diagnostics(): Promise<{ configured: boolean; state: KeyStoreState }> {
    let store: X509KeyStoreService;
    try {
      store = this.store;
    } catch (error) {
      if (error instanceof OpenBaoTransitConfigError) {
        logger.error({ reason: error.message }, 'OpenBao X.509 key store is not configured');
        return { configured: false, state: 'unavailable' };
      }
      throw error;
    }
    return { configured: true, state: await store.status() };
  }

  /** Create a key pair (RSA or ECDSA) for a certificate. */
  async createKeyPair(options: {
    sizeInBits?: number;
    tags?: string[];
    purpose: 'ca' | 'certificate';
    entityId?: string;
    keyAlgorithm?: string;
  }): Promise<KeyPairIds> {
    const result = await this.audited(
      'kms.create_key_pair', options.purpose, options.entityId ?? null,
      { sizeInBits: options.sizeInBits, keyAlgorithm: options.keyAlgorithm, tags: options.tags },
      async () => {
        const { privateKeyId, publicKeyId } = await this.store.createKeyPair(options);
        return { privateKeyId, publicKeyId };
      },
      (r) => ({ ...r }),
    );
    logger.info({ ...result, purpose: options.purpose }, 'Created key pair in OpenBao');
    return result;
  }

  /** Certificate PEM. */
  async getCertificate(certificateId: string, entityId?: string): Promise<string> {
    return this.audited('kms.get_certificate', 'certificate', entityId || certificateId, { certificateId }, () => this.store.getCertificatePem(certificateId));
  }

  /** Private key id linked to a certificate. */
  async getCertificatePrivateKeyId(certificateId: string, entityId?: string): Promise<string> {
    return this.audited('kms.resolve_private_key_id', 'certificate', entityId || certificateId, { certificateId },
      () => this.store.getCertificatePrivateKeyId(certificateId), (privateKeyId) => ({ privateKeyId }));
  }

  /** Public key id linked to a private key. */
  async getPublicKeyIdForPrivateKey(privateKeyId: string): Promise<string> {
    return this.store.getPublicKeyIdForPrivateKey(privateKeyId);
  }

  /** SubjectPublicKeyInfo PEM of a key. */
  async getPublicKey(keyId: string, entityId?: string): Promise<string> {
    return this.audited('kms.get_public_key', 'key', entityId || keyId, { keyId }, () => this.store.getPublicKeyPem(keyId));
  }

  /**
   * PKCS#8 PEM of a private key. Only keys created exportable (leaf keys; CA keys when
   * `ALLOW_CA_KEY_EXPORT` was on at CA creation) can be exported; OpenBao refuses the others.
   */
  async getPrivateKey(keyId: string, entityId?: string): Promise<string> {
    const pem = await this.audited('kms.get_private_key', 'key', entityId || keyId, { keyId }, () => this.store.exportPrivateKeyPem(keyId));
    logger.warn({ keyId, entityId }, 'Private key exported from OpenBao - ensure secure handling');
    return pem;
  }

  /**
   * Issue a certificate. Modes (see `X509KeyStoreService.certify`): CSR (`csr` +
   * `preserveCsrKey`), existing key pair (`publicKeyId` + `subjectName`), or a new key pair
   * (`keyAlgorithm` + `subjectName`, self-signed CA). `issuerName` is not used: the issuer
   * name is the issuer certificate's subject.
   */
  async signCertificate(options: {
    csr?: string;
    publicKeyId?: string;
    issuerPrivateKeyId?: string;
    issuerCertificateId?: string;
    issuerName?: string;
    subjectName?: string;
    daysValid?: number;
    tags?: string[];
    entityId?: string;
    keySizeInBits?: number;
    keyAlgorithm?: string;
    x509Extensions?: string;
    preserveCsrKey?: boolean;
  }): Promise<CertificateInfo> {
    const result = await this.audited(
      'kms.sign_certificate', 'certificate', options.entityId ?? null,
      { issuerCertificateId: options.issuerCertificateId, subjectName: options.subjectName, daysValid: options.daysValid, csr: !!options.csr },
      () => this.store.certify(options),
      (r) => ({ certificateId: r.certificateId, privateKeyId: r.privateKeyId, publicKeyId: r.publicKeyId }),
    );
    logger.info({ certificateId: result.certificateId, subjectName: options.subjectName }, 'Signed certificate with OpenBao');
    return { certificateId: result.certificateId, certificateData: result.certificateData, privateKeyId: result.privateKeyId, publicKeyId: result.publicKeyId };
  }

  /** X.509 signature over `data` (CRLs): RSA PKCS#1 v1.5 or ECDSA DER. The key stays in OpenBao. */
  async signData(keyId: string, data: Buffer, hash: SignHash, entityId?: string): Promise<Buffer> {
    return this.audited('kms.sign', 'key', entityId ?? keyId, { keyId, bytes: data.length, hash }, () => this.store.signData(keyId, data, hash));
  }

  /** Refuse further signatures with a key. */
  async revokeKey(keyId: string, reason?: string, entityId?: string): Promise<void> {
    await this.audited('kms.revoke_key', 'key', entityId || keyId, { keyId, reason }, () => this.store.revoke(keyId));
    logger.info({ keyId, reason }, 'Revoked key in the key store');
  }

  /** Delete a key (its Transit key) or a certificate object. */
  async destroyKey(keyId: string, entityId?: string): Promise<void> {
    await this.audited('kms.destroy_key', 'key', entityId || keyId, { keyId }, () => this.store.destroy(keyId));
    logger.info({ keyId }, 'Destroyed key in the key store');
  }

  /**
   * @deprecated Cosmian SSH key pairs. SSH CA keys are in `services/ssh-ca-key.ts`; this
   * service has no SSH keys. Kept only so old test cleanup code compiles.
   */
  async destroyKeyPair(_privateKeyId: string, _publicKeyId: string, _entityId?: string): Promise<void> {
    throw new Error('SSH key pairs are not in the X.509 key service (services/ssh-ca-key.ts)');
  }

  /** @deprecated Cosmian SignatureVerify of SSH CA keys. See `destroyKeyPair`. */
  async signatureVerify(_publicKeyId: string, _data: Buffer, _signature: Buffer): Promise<boolean> {
    throw new Error('SSH signatures are verified by services/ssh-ca-key.ts, not by the X.509 key service');
  }
}

let kmsServiceInstance: KMSService | null = null;

/** The process-wide key service. */
export function getKMSService(): KMSService {
  kmsServiceInstance ??= new KMSService({ enableAuditLog: true });
  return kmsServiceInstance;
}

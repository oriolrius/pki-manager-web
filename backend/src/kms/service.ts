import { randomUUID } from "crypto";
import { KMSClient, type KMSClientConfig } from "./client.js";
import type { KeyPairIds, CertificateInfo } from "./types.js";
import { db } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export interface KMSServiceOptions {
  kmsUrl: string;
  kmsApiKey?: string;
  enableAuditLog?: boolean;
}

export class KMSService {
  private client: KMSClient;
  private enableAuditLog: boolean;

  constructor(options: KMSServiceOptions) {
    const config: KMSClientConfig = {
      url: options.kmsUrl,
      apiKey: options.kmsApiKey,
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
    };

    this.client = new KMSClient(config);
    this.enableAuditLog = options.enableAuditLog !== false;
  }

  /**
   * Log KMS operation to audit trail
   */
  private async logAudit(
    operation: string,
    entityType: string,
    entityId: string | null,
    status: "success" | "failure",
    details: Record<string, unknown>,
    kmsOperationId?: string
  ): Promise<void> {
    if (!this.enableAuditLog) {
      return;
    }

    try {
      await db.insert(auditLog).values({
        id: randomUUID(),
        operation,
        entityType,
        entityId,
        status,
        details: JSON.stringify(details),
        kmsOperationId,
        ipAddress: null, // Can be set from context in tRPC procedures
      });
    } catch (error) {
      logger.error({ error }, "Failed to write audit log");
    }
  }

  /**
   * Test connection to KMS
   */
  async testConnection(): Promise<boolean> {
    const operationId = randomUUID();
    try {
      const result = await this.client.testConnection();
      await this.logAudit(
        "kms.test_connection",
        "kms",
        null,
        "success",
        { result },
        operationId
      );
      return result;
    } catch (error) {
      await this.logAudit(
        "kms.test_connection",
        "kms",
        null,
        "failure",
        { error: String(error) },
        operationId
      );
      throw error;
    }
  }

  /**
   * Create a key pair (RSA or ECDSA) for a CA or certificate
   */
  async createKeyPair(options: {
    sizeInBits?: number;
    tags?: string[];
    purpose: "ca" | "certificate";
    entityId?: string;
    keyAlgorithm?: string; // e.g., "RSA-4096", "ECDSA-P256"
  }): Promise<KeyPairIds> {
    const operationId = randomUUID();
    try {
      const result = await this.client.createKeyPair({
        sizeInBits: options.sizeInBits,
        tags: options.tags,
        keyAlgorithm: options.keyAlgorithm,
      });

      await this.logAudit(
        "kms.create_key_pair",
        options.purpose,
        options.entityId || null,
        "success",
        {
          sizeInBits: options.sizeInBits,
          tags: options.tags,
          privateKeyId: result.privateKeyId,
          publicKeyId: result.publicKeyId,
        },
        operationId
      );

      logger.info(
        {
          privateKeyId: result.privateKeyId,
          publicKeyId: result.publicKeyId,
          purpose: options.purpose,
        },
        "Created key pair in KMS"
      );

      return result;
    } catch (error) {
      await this.logAudit(
        "kms.create_key_pair",
        options.purpose,
        options.entityId || null,
        "failure",
        { error: String(error), sizeInBits: options.sizeInBits },
        operationId
      );
      throw error;
    }
  }

  /**
   * Get certificate from KMS in PEM format
   */
  async getCertificate(certificateId: string, entityId?: string): Promise<string> {
    const operationId = randomUUID();
    try {
      const result = await this.client.getCertificate(certificateId);

      await this.logAudit(
        "kms.get_certificate",
        "certificate",
        entityId || certificateId,
        "success",
        { certificateId },
        operationId
      );

      return result;
    } catch (error) {
      await this.logAudit(
        "kms.get_certificate",
        "certificate",
        entityId || certificateId,
        "failure",
        { error: String(error), certificateId },
        operationId
      );
      throw error;
    }
  }

  /**
   * Get public key in PEM format
   */
  async getPublicKey(keyId: string, entityId?: string): Promise<string> {
    const operationId = randomUUID();
    try {
      const result = await this.client.getPublicKey(keyId);

      await this.logAudit(
        "kms.get_public_key",
        "key",
        entityId || keyId,
        "success",
        { keyId },
        operationId
      );

      return result;
    } catch (error) {
      await this.logAudit(
        "kms.get_public_key",
        "key",
        entityId || keyId,
        "failure",
        { error: String(error), keyId },
        operationId
      );
      throw error;
    }
  }

  /**
   * Get private key in PEM format (PKCS#8)
   * WARNING: This exports the private key from KMS. Use with caution and only when necessary.
   */
  async getPrivateKey(keyId: string, entityId?: string): Promise<string> {
    const operationId = randomUUID();
    try {
      const result = await this.client.getPrivateKey(keyId);

      await this.logAudit(
        "kms.get_private_key",
        "key",
        entityId || keyId,
        "success",
        { keyId },
        operationId
      );

      logger.warn(
        { keyId, entityId },
        "Private key exported from KMS - ensure secure handling"
      );

      return result;
    } catch (error) {
      await this.logAudit(
        "kms.get_private_key",
        "key",
        entityId || keyId,
        "failure",
        { error: String(error), keyId },
        operationId
      );
      throw error;
    }
  }

  /**
   * Sign a certificate (certify operation)
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
    keySizeInBits?: number; // Key size for KMS to generate (deprecated, use keyAlgorithm)
    keyAlgorithm?: string; // Key algorithm (e.g., "RSA-4096", "ECDSA-P256")
  }): Promise<CertificateInfo> {
    const operationId = randomUUID();
    try {
      const result = await this.client.certify({
        csr: options.csr,
        publicKeyId: options.publicKeyId,
        issuerPrivateKeyId: options.issuerPrivateKeyId,
        issuerCertificateId: options.issuerCertificateId,
        issuerName: options.issuerName,
        subjectName: options.subjectName,
        daysValid: options.daysValid,
        tags: options.tags,
        keySizeInBits: options.keySizeInBits,
        keyAlgorithm: options.keyAlgorithm,
      });

      await this.logAudit(
        "kms.sign_certificate",
        "certificate",
        options.entityId || null,
        "success",
        {
          certificateId: result.certificateId,
          issuerPrivateKeyId: options.issuerPrivateKeyId,
          subjectName: options.subjectName,
          daysValid: options.daysValid,
        },
        operationId
      );

      logger.info(
        {
          certificateId: result.certificateId,
          subjectName: options.subjectName,
        },
        "Signed certificate in KMS"
      );

      return result;
    } catch (error) {
      await this.logAudit(
        "kms.sign_certificate",
        "certificate",
        options.entityId || null,
        "failure",
        {
          error: String(error),
          issuerPrivateKeyId: options.issuerPrivateKeyId,
          subjectName: options.subjectName,
        },
        operationId
      );
      throw error;
    }
  }

  /**
   * Revoke a key
   */
  async revokeKey(
    keyId: string,
    reason?: string,
    entityId?: string
  ): Promise<void> {
    const operationId = randomUUID();
    try {
      await this.client.revokeKey(keyId, reason);

      await this.logAudit(
        "kms.revoke_key",
        "key",
        entityId || keyId,
        "success",
        { keyId, reason },
        operationId
      );

      logger.info({ keyId, reason }, "Revoked key in KMS");
    } catch (error) {
      await this.logAudit(
        "kms.revoke_key",
        "key",
        entityId || keyId,
        "failure",
        { error: String(error), keyId, reason },
        operationId
      );
      throw error;
    }
  }

  /**
   * Destroy a key (must be revoked first)
   */
  async destroyKey(keyId: string, entityId?: string): Promise<void> {
    const operationId = randomUUID();
    try {
      await this.client.destroyKey(keyId);

      await this.logAudit(
        "kms.destroy_key",
        "key",
        entityId || keyId,
        "success",
        { keyId },
        operationId
      );

      logger.info({ keyId }, "Destroyed key in KMS");
    } catch (error) {
      await this.logAudit(
        "kms.destroy_key",
        "key",
        entityId || keyId,
        "failure",
        { error: String(error), keyId },
        operationId
      );
      throw error;
    }
  }

  /**
   * Revoke and destroy a key pair
   */
  async destroyKeyPair(
    privateKeyId: string,
    publicKeyId: string,
    entityId?: string
  ): Promise<void> {
    const operationId = randomUUID();
    try {
      await this.client.destroyKeyPair(privateKeyId, publicKeyId);

      await this.logAudit(
        "kms.destroy_key_pair",
        "key_pair",
        entityId || privateKeyId,
        "success",
        { privateKeyId, publicKeyId },
        operationId
      );

      logger.info({ privateKeyId, publicKeyId }, "Destroyed key pair in KMS");
    } catch (error) {
      await this.logAudit(
        "kms.destroy_key_pair",
        "key_pair",
        entityId || privateKeyId,
        "failure",
        { error: String(error), privateKeyId, publicKeyId },
        operationId
      );
      throw error;
    }
  }
}

// Singleton instance
let kmsServiceInstance: KMSService | null = null;

/**
 * Get or create KMS service instance
 */
export function getKMSService(): KMSService {
  if (!kmsServiceInstance) {
    const kmsUrl = process.env.KMS_URL || 'http://wsl.ymbihq.local:42998';

    kmsServiceInstance = new KMSService({
      kmsUrl,
      kmsApiKey: process.env.KMS_API_KEY,
      enableAuditLog: true,
    });
  }

  return kmsServiceInstance;
}

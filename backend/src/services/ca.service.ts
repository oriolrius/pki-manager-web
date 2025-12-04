import { randomUUID } from 'crypto';
import { eq, and, sql, like, desc, asc } from 'drizzle-orm';
import forge from 'node-forge';
import { certificateAuthorities, certificates, crls, auditLog } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { formatDN } from '../crypto/dn.js';
import { parseCertificate } from '../crypto/x509.js';
import { logger } from '../lib/logger.js';
import type { DistinguishedName } from '../crypto/types.js';
import type { ServiceContext } from './types.js';

// Types for CA Service inputs and outputs
export interface ListCAsParams {
  status?: 'active' | 'revoked' | 'expired';
  search?: string;
  sortBy?: 'name' | 'issuedDate' | 'expiryDate';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CAListItem {
  id: string;
  subject: string;
  serialNumber: string;
  keyAlgorithm: string | null;
  notBefore: string;
  notAfter: string;
  status: 'active' | 'revoked' | 'expired';
  certificateCount: number;
  createdAt: string;
}

export interface CADetails {
  id: string;
  subject: Record<string, string | undefined>;
  subjectDn: string;
  issuer: Record<string, string | undefined>;
  issuerDn: string;
  serialNumber: string;
  keyAlgorithm: string;
  notBefore: string;
  notAfter: string;
  validityStatus: 'valid' | 'expired' | 'not_yet_valid';
  status: 'active' | 'revoked' | 'expired';
  extensions: Record<string, unknown>;
  fingerprints: {
    sha256: string;
    sha1: string;
  };
  certificatePem: string;
  issuedCertificateCount: number;
  revocationDate?: string;
  revocationReason?: string | null;
  kmsCertificateId?: string;
  kmsKeyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCAParams {
  subject: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  keyAlgorithm: string;
  validityYears?: number;
  tags?: string[];
}

export interface CreateCAResult {
  id: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  status: 'active';
}

export interface RevokeCAParams {
  id: string;
  reason: string;
  details?: string;
}

export interface RevokeCAResult {
  success: boolean;
  caId: string;
  revocationDate: string;
  reason: string;
  cascadeRevokedCount: number;
  crlGenerated: boolean;
  crlId: string;
}

export interface DeleteCAParams {
  id: string;
  destroyKey?: boolean;
  // forceDelete skips revocation/expiration checks, used for orphaned records
  forceDelete?: boolean;
}

export interface DeleteCAResult {
  success: boolean;
  caId: string;
  keyDestroyed: boolean;
  crlsDeleted: number;
}

// Re-export ServiceContext for consumers that import from this module
export type { ServiceContext };

/**
 * CA Service - Business logic for Certificate Authority operations
 * Shared between tRPC and REST API layers
 */
export class CAService {
  /**
   * List CAs with filtering, sorting, and pagination
   */
  async list(ctx: ServiceContext, params?: ListCAsParams): Promise<CAListItem[]> {
    const {
      status,
      search,
      sortBy = 'issuedDate',
      sortOrder = 'desc',
      limit = 50,
      offset = 0,
    } = params || {};

    const now = new Date();

    // Build WHERE conditions
    const conditions: any[] = [];

    if (status) {
      if (status === 'expired') {
        conditions.push(sql`${certificateAuthorities.notAfter} < ${now.getTime() / 1000}`);
      } else if (status === 'active') {
        conditions.push(
          and(
            eq(certificateAuthorities.status, 'active'),
            sql`${certificateAuthorities.notAfter} >= ${now.getTime() / 1000}`,
          )!,
        );
      } else {
        conditions.push(eq(certificateAuthorities.status, status));
      }
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(like(certificateAuthorities.subjectDn, searchPattern));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Determine sort column
    let orderByColumn;
    switch (sortBy) {
      case 'name':
        orderByColumn = certificateAuthorities.subjectDn;
        break;
      case 'expiryDate':
        orderByColumn = certificateAuthorities.notAfter;
        break;
      case 'issuedDate':
      default:
        orderByColumn = certificateAuthorities.notBefore;
        break;
    }

    const orderBy = sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

    // Query CAs with pagination
    const cas = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Get certificate counts for each CA
    const casWithCounts = await Promise.all(
      cas.map(async (ca: any) => {
        const certCount = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(certificates)
          .where(eq(certificates.caId, ca.id));

        let computedStatus: 'active' | 'revoked' | 'expired' = ca.status;
        if (ca.status === 'active' && ca.notAfter < now) {
          computedStatus = 'expired';
        }

        return {
          id: ca.id,
          subject: ca.subjectDn,
          serialNumber: ca.serialNumber,
          keyAlgorithm: ca.keyAlgorithm,
          notBefore: ca.notBefore.toISOString(),
          notAfter: ca.notAfter.toISOString(),
          status: computedStatus,
          certificateCount: Number(certCount[0]?.count || 0),
          createdAt: ca.createdAt.toISOString(),
        };
      }),
    );

    return casWithCounts;
  }

  /**
   * Get CA by ID with full details
   */
  async getById(ctx: ServiceContext, id: string): Promise<CADetails> {
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, id))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CANotFoundError(id);
    }

    const caRecord = ca[0];
    const now = new Date();

    // Fetch certificate from KMS
    const kmsService = getKMSService();
    let certificatePem: string;
    try {
      certificatePem = await kmsService.getCertificate(
        caRecord.kmsCertificateId,
        caRecord.id
      );
    } catch (kmsError) {
      // CA exists in DB but certificate not found in KMS - data inconsistency
      logger.warn(
        { caId: id, kmsCertificateId: caRecord.kmsCertificateId, error: kmsError },
        'CA exists in database but certificate not found in KMS - data inconsistency detected'
      );
      throw new CAKmsInconsistencyError(
        id,
        kmsError instanceof Error ? kmsError.message : String(kmsError),
        {
          kmsCertificateId: caRecord.kmsCertificateId,
          subjectDn: caRecord.subjectDn,
          serialNumber: caRecord.serialNumber,
        }
      );
    }

    // Parse certificate to extract detailed information
    const certMetadata = parseCertificate(certificatePem, 'PEM');

    // Calculate fingerprints using node-forge
    const cert = forge.pki.certificateFromPem(certificatePem);
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();

    const sha256Digest = forge.md.sha256.create();
    sha256Digest.update(derBytes);
    const sha256Fingerprint = sha256Digest.digest().toHex().toUpperCase();

    const sha1Digest = forge.md.sha1.create();
    sha1Digest.update(derBytes);
    const sha1Fingerprint = sha1Digest.digest().toHex().toUpperCase();

    const formatFingerprint = (hex: string) =>
      hex.match(/.{1,2}/g)?.join(':') || hex;

    // Extract extensions
    const extensions: Record<string, unknown> = {};

    for (const ext of certMetadata.extensions) {
      if (ext.name === 'basicConstraints') {
        extensions.basicConstraints = {
          cA: (ext as any).cA || false,
          pathLenConstraint: (ext as any).pathLenConstraint,
        };
      } else if (ext.name === 'keyUsage') {
        extensions.keyUsage = {
          digitalSignature: (ext as any).digitalSignature || false,
          nonRepudiation: (ext as any).nonRepudiation || false,
          keyEncipherment: (ext as any).keyEncipherment || false,
          dataEncipherment: (ext as any).dataEncipherment || false,
          keyAgreement: (ext as any).keyAgreement || false,
          keyCertSign: (ext as any).keyCertSign || false,
          cRLSign: (ext as any).cRLSign || false,
          encipherOnly: (ext as any).encipherOnly || false,
          decipherOnly: (ext as any).decipherOnly || false,
        };
      } else if (ext.name === 'subjectKeyIdentifier') {
        const skiExt = cert.extensions.find((e: any) => e.name === 'subjectKeyIdentifier');
        if (skiExt && (skiExt as any).subjectKeyIdentifier) {
          extensions.subjectKeyIdentifier = (skiExt as any).subjectKeyIdentifier;
        }
      } else if (ext.name === 'authorityKeyIdentifier') {
        const akiExt = cert.extensions.find((e: any) => e.name === 'authorityKeyIdentifier');
        if (akiExt && (akiExt as any).keyIdentifier) {
          extensions.authorityKeyIdentifier = (akiExt as any).keyIdentifier;
        }
      }
    }

    // Compute validity status
    let validityStatus: 'valid' | 'expired' | 'not_yet_valid' = 'valid';
    if (now < caRecord.notBefore) {
      validityStatus = 'not_yet_valid';
    } else if (now > caRecord.notAfter) {
      validityStatus = 'expired';
    }

    // Compute overall status
    let status: 'active' | 'revoked' | 'expired' = caRecord.status;
    if (caRecord.status === 'active' && now > caRecord.notAfter) {
      status = 'expired';
    }

    // Count issued certificates
    const certCount = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(certificates)
      .where(eq(certificates.caId, id));

    return {
      id: caRecord.id,
      subject: certMetadata.subject,
      subjectDn: caRecord.subjectDn,
      issuer: certMetadata.issuer,
      issuerDn: caRecord.subjectDn, // Self-signed, so issuer = subject
      serialNumber: caRecord.serialNumber,
      keyAlgorithm: certMetadata.keyAlgorithm,
      notBefore: caRecord.notBefore.toISOString(),
      notAfter: caRecord.notAfter.toISOString(),
      validityStatus,
      status,
      extensions,
      fingerprints: {
        sha256: formatFingerprint(sha256Fingerprint),
        sha1: formatFingerprint(sha1Fingerprint),
      },
      certificatePem,
      issuedCertificateCount: Number(certCount[0]?.count || 0),
      revocationDate: caRecord.revocationDate?.toISOString(),
      revocationReason: caRecord.revocationReason,
      kmsCertificateId: caRecord.kmsCertificateId,
      kmsKeyId: caRecord.kmsKeyId,
      createdAt: caRecord.createdAt.toISOString(),
      updatedAt: caRecord.updatedAt.toISOString(),
    };
  }

  /**
   * Create a new CA
   */
  async create(ctx: ServiceContext, params: CreateCAParams): Promise<CreateCAResult> {
    const caId = randomUUID();
    const kmsService = getKMSService();

    try {
      // Convert API schema DN to crypto DN format
      const subjectDN: DistinguishedName = {
        CN: params.subject.commonName,
        O: params.subject.organization,
        OU: params.subject.organizationalUnit,
        C: params.subject.country,
        ST: params.subject.state,
        L: params.subject.locality,
      };

      const validityDays = (params.validityYears || 20) * 365;
      const subjectName = formatDN(subjectDN);

      logger.info(
        { caId, subjectName, validityDays, keyAlgorithm: params.keyAlgorithm },
        'Creating self-signed root certificate with key pair in KMS',
      );

      // X.509 extensions for CA certificates per RFC 5280:
      // - basicConstraints: CA:TRUE (required, critical) - identifies this as a CA certificate
      // - keyUsage: keyCertSign, crlSign (required, critical) - allows signing certificates and CRLs
      // - subjectKeyIdentifier: hash - helps identify certificates issued by this CA
      const caExtensions = `[ v3_ca ]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,crlSign
subjectKeyIdentifier=hash
`;

      const certInfo = await kmsService.signCertificate({
        subjectName: subjectName,
        daysValid: validityDays,
        tags: params.tags || [],
        entityId: caId,
        keyAlgorithm: params.keyAlgorithm,
        x509Extensions: caExtensions,
      });

      // Convert certificate data from hex to PEM
      const certDataHex = certInfo.certificateData;
      const certDataBuffer = Buffer.from(certDataHex, 'hex');
      const certBase64 = certDataBuffer.toString('base64');
      const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

      // Parse certificate to extract metadata
      const certMetadata = parseCertificate(certificatePem, 'PEM');

      const notBefore = certMetadata.validity.notBefore;
      const notAfter = certMetadata.validity.notAfter;

      if (!certInfo.privateKeyId || !certInfo.publicKeyId) {
        logger.warn(
          { caId, certificateId: certInfo.certificateId },
          'KMS did not return generated key IDs - will need to query them later'
        );
      }

      // Store CA record in database
      await ctx.db.insert(certificateAuthorities).values({
        id: caId,
        kmsCertificateId: certInfo.certificateId,
        kmsKeyId: certInfo.privateKeyId || certInfo.certificateId,
        subjectDn: subjectName,
        serialNumber: certMetadata.serialNumber,
        keyAlgorithm: certMetadata.keyAlgorithm,
        notBefore: notBefore,
        notAfter: notAfter,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.create',
        entityType: 'ca',
        entityId: caId,
        status: 'success',
        details: JSON.stringify({
          subject: subjectName,
          keyAlgorithm: params.keyAlgorithm,
          validityYears: params.validityYears,
          serialNumber: certMetadata.serialNumber,
          kmsPrivateKeyId: certInfo.privateKeyId,
          kmsPublicKeyId: certInfo.publicKeyId,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      logger.info({ caId, subjectName }, 'CA created successfully');

      return {
        id: caId,
        subject: subjectName,
        serialNumber: certMetadata.serialNumber,
        notBefore: notBefore.toISOString(),
        notAfter: notAfter.toISOString(),
        status: 'active',
      };
    } catch (error) {
      logger.error({ error, caId }, 'Failed to create CA');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.create',
        entityType: 'ca',
        entityId: caId,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          subject: formatDN({
            CN: params.subject.commonName,
            O: params.subject.organization,
            OU: params.subject.organizationalUnit,
            C: params.subject.country,
            ST: params.subject.state,
            L: params.subject.locality,
          }),
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CAOperationError('create', error);
    }
  }

  /**
   * Revoke a CA
   */
  async revoke(ctx: ServiceContext, params: RevokeCAParams): Promise<RevokeCAResult> {
    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, params.id))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CANotFoundError(params.id);
    }

    const caRecord = ca[0];

    // Validate CA is not already revoked
    if (caRecord.status === 'revoked') {
      throw new CAAlreadyRevokedError(params.id);
    }

    const revocationDate = new Date();

    try {
      // Update CA status to revoked
      await ctx.db
        .update(certificateAuthorities)
        .set({
          status: 'revoked',
          revocationDate: revocationDate,
          revocationReason: params.reason,
          updatedAt: new Date(),
        } as any)
        .where(eq(certificateAuthorities.id, params.id));

      // Cascade revocation to all active certificates
      let revokedCertCount = 0;
      const activeCerts = await ctx.db
        .select()
        .from(certificates)
        .where(and(eq(certificates.caId, params.id), eq(certificates.status, 'active'))!);

      for (const cert of activeCerts) {
        await ctx.db
          .update(certificates)
          .set({
            status: 'revoked',
            revocationDate: revocationDate,
            revocationReason: 'caCompromise',
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, cert.id));

        revokedCertCount++;
      }

      // Get all revoked certificates for CRL
      const revokedCerts = await ctx.db
        .select()
        .from(certificates)
        .where(and(eq(certificates.caId, params.id), eq(certificates.status, 'revoked'))!);

      // Get the latest CRL number for this CA
      const latestCrl = await ctx.db
        .select()
        .from(crls)
        .where(eq(crls.caId, params.id))
        .orderBy(desc(crls.crlNumber))
        .limit(1);

      const nextCrlNumber = latestCrl.length > 0 ? latestCrl[0].crlNumber + 1 : 1;

      // Create CRL record
      const crlId = randomUUID();
      const thisUpdate = new Date();
      const nextUpdate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await ctx.db.insert(crls).values({
        id: crlId,
        caId: params.id,
        crlNumber: nextCrlNumber,
        thisUpdate: thisUpdate,
        nextUpdate: nextUpdate,
        crlPem: '', // TODO: Generate actual CRL PEM with KMS signing
        revokedCount: revokedCerts.length,
        createdAt: new Date(),
      } as any);

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.revoke',
        entityType: 'ca',
        entityId: params.id,
        status: 'success',
        details: JSON.stringify({
          reason: params.reason,
          details: params.details,
          cascadeRevoked: revokedCertCount,
          crlGenerated: true,
          crlId: crlId,
          crlNumber: nextCrlNumber,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      logger.info(
        { caId: params.id, reason: params.reason, cascadeRevoked: revokedCertCount },
        'CA revoked successfully',
      );

      return {
        success: true,
        caId: params.id,
        revocationDate: revocationDate.toISOString(),
        reason: params.reason,
        cascadeRevokedCount: revokedCertCount,
        crlGenerated: true,
        crlId: crlId,
      };
    } catch (error) {
      logger.error({ error, caId: params.id }, 'Failed to revoke CA');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.revoke',
        entityType: 'ca',
        entityId: params.id,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          reason: params.reason,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CAOperationError('revoke', error);
    }
  }

  /**
   * Delete a CA
   */
  async delete(ctx: ServiceContext, params: DeleteCAParams): Promise<DeleteCAResult> {
    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, params.id))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CANotFoundError(params.id);
    }

    const caRecord = ca[0];
    const now = new Date();

    // Validate CA is revoked or expired (unless forceDelete is true)
    // forceDelete allows removing orphaned DB records when KMS data is missing
    const isExpired = now > caRecord.notAfter;
    const isRevoked = caRecord.status === 'revoked';

    if (!params.forceDelete && !isRevoked && !isExpired) {
      throw new CANotRevokableError(params.id);
    }

    // Validate no active certificates exist
    const activeCerts = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(certificates)
      .where(and(eq(certificates.caId, params.id), eq(certificates.status, 'active'))!);

    const activeCertCount = Number(activeCerts[0]?.count || 0);
    if (activeCertCount > 0) {
      throw new CAHasActiveCertificatesError(params.id, activeCertCount);
    }

    try {
      // Create audit entry before deletion
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.delete',
        entityType: 'ca',
        entityId: params.id,
        status: 'success',
        details: JSON.stringify({
          subjectDn: caRecord.subjectDn,
          serialNumber: caRecord.serialNumber,
          kmsKeyId: caRecord.kmsKeyId,
          destroyKey: params.destroyKey,
          wasRevoked: isRevoked,
          wasExpired: isExpired,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      // Optional: Destroy KMS key
      let keyDestroyed = false;
      if (params.destroyKey) {
        try {
          const kmsService = getKMSService();
          const kmsKeyId = caRecord.kmsKeyId;

          try {
            await kmsService.revokeKey(kmsKeyId, 'CA deleted', params.id);
          } catch (revokeError) {
            logger.warn({ kmsKeyId, error: revokeError }, 'Key revocation failed, may already be revoked');
          }

          await kmsService.destroyKey(kmsKeyId, params.id);
          keyDestroyed = true;
          logger.info({ kmsKeyId, caId: params.id }, 'KMS key destroyed');
        } catch (kmsError) {
          logger.error({ error: kmsError, caId: params.id }, 'Failed to destroy KMS key');
        }
      }

      // Clean up orphaned CRLs
      const deletedCrls = await ctx.db
        .delete(crls)
        .where(eq(crls.caId, params.id))
        .returning({ id: crls.id });

      // Delete CA record from database
      await ctx.db
        .delete(certificateAuthorities)
        .where(eq(certificateAuthorities.id, params.id));

      logger.info(
        { caId: params.id, keyDestroyed, crlsDeleted: deletedCrls.length },
        'CA deleted successfully',
      );

      return {
        success: true,
        caId: params.id,
        keyDestroyed,
        crlsDeleted: deletedCrls.length,
      };
    } catch (error) {
      logger.error({ error, caId: params.id }, 'Failed to delete CA');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'ca.delete',
        entityType: 'ca',
        entityId: params.id,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CAOperationError('delete', error);
    }
  }
}

// Custom Error Classes
export class CANotFoundError extends Error {
  constructor(public caId: string) {
    super(`CA with ID ${caId} not found`);
    this.name = 'CANotFoundError';
  }
}

export class CAAlreadyRevokedError extends Error {
  constructor(public caId: string) {
    super('CA is already revoked');
    this.name = 'CAAlreadyRevokedError';
  }
}

export class CANotRevokableError extends Error {
  constructor(public caId: string) {
    super('CA must be revoked or expired before deletion');
    this.name = 'CANotRevokableError';
  }
}

export class CAHasActiveCertificatesError extends Error {
  constructor(public caId: string, public certCount: number) {
    super(`Cannot delete CA with ${certCount} active certificate(s). Revoke all certificates first.`);
    this.name = 'CAHasActiveCertificatesError';
  }
}

export class CAOperationError extends Error {
  constructor(public operation: string, public cause: unknown) {
    super(`Failed to ${operation} CA: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CAOperationError';
  }
}

export class CAKmsInconsistencyError extends Error {
  constructor(
    public caId: string,
    public kmsError: string,
    public metadata?: {
      kmsCertificateId?: string;
      subjectDn?: string;
      serialNumber?: string;
    }
  ) {
    super(`CA ${caId} exists in database but certificate not found in KMS: ${kmsError}`);
    this.name = 'CAKmsInconsistencyError';
  }
}

// Singleton instance
let caServiceInstance: CAService | null = null;

export function getCAService(): CAService {
  if (!caServiceInstance) {
    caServiceInstance = new CAService();
  }
  return caServiceInstance;
}

import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { eq, and, sql, like, desc, asc } from 'drizzle-orm';
import forge from 'node-forge';
import { certificateAuthorities, certificates, crls, auditLog } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getCRLService } from './crl.service.js';
import { formatDN } from '../crypto/dn.js';
import { findForgeExtension, parseCertificate } from '../crypto/x509.js';
import { logger } from '../lib/logger.js';
import type { DistinguishedName } from '../crypto/types.js';
import type { ServiceContext } from './types.js';
import { isKeyStoreUnavailable } from '../keystore/errors.js';

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
  subject: DistinguishedName;
  subjectDn: string;
  issuer: DistinguishedName;
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
  keyAlgorithm: string | null;
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
  /** Id of the signed CRL made after the revocation; absent when the CRL generation failed. */
  crlId?: string;
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
    const conditions: SQL[] = [];

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
      cas.map(async (ca) => {
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
      // An unavailable key store is an outage, not an inconsistency: 503 KEY_STORE_UNAVAILABLE.
      if (isKeyStoreUnavailable(kmsError)) throw kmsError;
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
        },
        { cause: kmsError }
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
          cA: ext.cA || false,
          pathLenConstraint: ext.pathLenConstraint,
        };
      } else if (ext.name === 'keyUsage') {
        extensions.keyUsage = {
          digitalSignature: ext.digitalSignature || false,
          nonRepudiation: ext.nonRepudiation || false,
          keyEncipherment: ext.keyEncipherment || false,
          dataEncipherment: ext.dataEncipherment || false,
          keyAgreement: ext.keyAgreement || false,
          keyCertSign: ext.keyCertSign || false,
          cRLSign: ext.cRLSign || false,
          encipherOnly: ext.encipherOnly || false,
          decipherOnly: ext.decipherOnly || false,
        };
      } else if (ext.name === 'subjectKeyIdentifier') {
        const skiExt = findForgeExtension(cert, 'subjectKeyIdentifier');
        if (skiExt && skiExt.subjectKeyIdentifier) {
          extensions.subjectKeyIdentifier = skiExt.subjectKeyIdentifier;
        }
      } else if (ext.name === 'authorityKeyIdentifier') {
        const akiExt = findForgeExtension(cert, 'authorityKeyIdentifier');
        if (akiExt && akiExt.keyIdentifier) {
          extensions.authorityKeyIdentifier = akiExt.keyIdentifier;
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

      // certify-from-subject generates the keypair server-side and the Certify response may
      // not surface the private-key id. Resolve it from the certificate's PrivateKeyLink so
      // kmsKeyId points at the real key (required for CRL signing and PKCS#12/key export).
      let resolvedKeyId = certInfo.privateKeyId;
      if (!resolvedKeyId) {
        try {
          resolvedKeyId = await kmsService.getCertificatePrivateKeyId(certInfo.certificateId, caId);
        } catch (linkError) {
          logger.warn(
            { caId, certificateId: certInfo.certificateId, error: linkError },
            'Could not resolve CA private key id from certificate link; storing certificate id as fallback'
          );
        }
      }

      // Store CA record in database
      await ctx.db.insert(certificateAuthorities).values({
        id: caId,
        kmsCertificateId: certInfo.certificateId,
        kmsKeyId: resolvedKeyId || certInfo.certificateId,
        subjectDn: subjectName,
        serialNumber: certMetadata.serialNumber,
        keyAlgorithm: certMetadata.keyAlgorithm,
        notBefore: notBefore,
        notAfter: notAfter,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

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
      });

      logger.info({ caId, subjectName }, 'CA created successfully');

      // Publish an initial (empty) signed CRL so the CRL distribution URL embedded in issued
      // certificates works immediately (best-effort; the public endpoint also generates one
      // lazily if this fails). CRL number starts at 1 and stays monotonic from there.
      await getCRLService().regenerateForCa(ctx, caId);

      return {
        id: caId,
        subject: subjectName,
        serialNumber: certMetadata.serialNumber,
        keyAlgorithm: certMetadata.keyAlgorithm,
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
      });

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
      // Mark the CA revoked and cascade to its active certificates in ONE synchronous
      // better-sqlite3 transaction: either the CA and all its certificates are revoked, or
      // nothing changes (a failure half-way must not leave a revoked CA with active certs).
      const revokedCertCount = ctx.db.transaction((tx) => {
        tx.update(certificateAuthorities)
          .set({
            status: 'revoked',
            revocationDate: revocationDate,
            revocationReason: params.reason,
            updatedAt: new Date(),
          })
          .where(eq(certificateAuthorities.id, params.id))
          .run();

        const cascade = tx
          .update(certificates)
          .set({
            status: 'revoked',
            revocationDate: revocationDate,
            revocationReason: 'caCompromise',
            updatedAt: new Date(),
          })
          .where(and(eq(certificates.caId, params.id), eq(certificates.status, 'active'))!)
          .run();
        return Number(cascade.changes);
      }) as number;

      // Publish a signed CRL that lists the cascaded certificates (issue #48). The CRL signer
      // accepts a revoked CA. It is best-effort: the revocation stays in force when the KMS
      // cannot sign now, the response says so (crlGenerated=false), and the public CRL
      // endpoint generates the CRL on the next request.
      let crl: { id: string; crlNumber: number } | null = null;
      try {
        const generated = await getCRLService().generate(ctx, { caId: params.id });
        crl = { id: generated.id, crlNumber: generated.crlNumber };
      } catch (crlError) {
        logger.warn(
          { caId: params.id, error: crlError instanceof Error ? crlError.message : String(crlError) },
          'CRL generation after CA revocation failed (revocation kept)',
        );
      }

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
          crlGenerated: crl !== null,
          crlId: crl?.id ?? null,
          crlNumber: crl?.crlNumber ?? null,
        }),
        ipAddress: ctx.ipAddress,
      });

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
        crlGenerated: crl !== null,
        ...(crl ? { crlId: crl.id } : {}),
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
      });

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
      });

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
      });

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
    },
    /** The key store error; a legacy (un-migrated) id maps to 409 KEY_MIGRATION_REQUIRED at the REST edge. */
    options?: { cause?: unknown }
  ) {
    super(`CA ${caId} exists in database but certificate not found in KMS: ${kmsError}`, options);
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

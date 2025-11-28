import { randomUUID } from 'crypto';
import { eq, and, desc, sql } from 'drizzle-orm';
import { certificateAuthorities, certificates, crls } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { parseCertificate } from '../crypto/x509.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import type { CRLEntry } from '../crypto/types.js';
import type { ServiceContext } from './types.js';

// Types for CRL Service inputs and outputs
export interface GenerateCRLParams {
  caId: string;
  nextUpdateDays?: number;
}

export interface GenerateCRLResult {
  id: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  revokedCount: number;
  note?: string;
}

export interface GetCRLParams {
  caId: string;
  crlNumber?: number;
}

export interface RevokedCertificateEntry {
  serialNumber: string;
  revocationDate: string | null;
  revocationReason: string | null;
}

export interface CRLDetails {
  id: string;
  caId: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  validityStatus: 'valid' | 'expired';
  revokedCount: number;
  crlPem: string | null;
  crlDer: string | null;
  revokedCertificates: RevokedCertificateEntry[];
  createdAt: string;
}

export interface ListCRLsParams {
  caId: string;
  limit?: number;
  offset?: number;
}

export interface CRLListItem {
  id: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  validityStatus: 'valid' | 'expired';
  revokedCount: number;
  createdAt: string;
}

export interface ListCRLsResult {
  items: CRLListItem[];
  totalCount: number;
  limit: number;
  offset: number;
}

// Re-export ServiceContext for consumers that import from this module
export type { ServiceContext };

/**
 * CRL Service - Business logic for Certificate Revocation List operations
 * Shared between tRPC and REST API layers
 */
export class CRLService {
  /**
   * Generate a new CRL for a CA
   */
  async generate(ctx: ServiceContext, params: GenerateCRLParams): Promise<GenerateCRLResult> {
    const { caId, nextUpdateDays = 7 } = params;

    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CRLCANotFoundError(caId);
    }

    const caRecord = ca[0];

    // Validate CA is active or revoked (can still generate CRL for revoked CA)
    if (caRecord.status !== 'active' && caRecord.status !== 'revoked') {
      throw new CRLInvalidCAStatusError(caId, caRecord.status);
    }

    // Fetch CA certificate from KMS
    const kmsService = getKMSService();
    const caCertificatePem = await kmsService.getCertificate(
      caRecord.kmsCertificateId,
      caRecord.id
    );

    const crlId = randomUUID();

    try {
      // Get all revoked certificates for this CA
      const revokedCerts = await ctx.db
        .select()
        .from(certificates)
        .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked'))!);

      logger.info(
        {
          caId,
          revokedCount: revokedCerts.length,
        },
        'Generating CRL'
      );

      // Get the latest CRL number for this CA
      const latestCrl = await ctx.db
        .select()
        .from(crls)
        .where(eq(crls.caId, caId))
        .orderBy(desc(crls.crlNumber))
        .limit(1);

      const nextCrlNumber = latestCrl.length > 0 ? latestCrl[0].crlNumber + 1 : 1;

      // Prepare CRL entries
      const crlEntries: CRLEntry[] = revokedCerts.map((cert: any) => ({
        serialNumber: cert.serialNumber,
        revocationDate: cert.revocationDate || new Date(),
        reason: undefined, // Simplified for now
      }));

      // Set CRL validity period
      const thisUpdate = new Date();
      const nextUpdate = new Date(Date.now() + nextUpdateDays * 24 * 60 * 60 * 1000);

      // Parse CA certificate to extract subject DN
      const caCertInfo = parseCertificate(caCertificatePem, 'PEM');

      // NOTE: CRL signing with KMS-stored keys is not yet supported
      // The current implementation uses a placeholder approach
      const crlPem = ''; // Placeholder - would contain actual CRL PEM

      // Store CRL record in database
      await ctx.db.insert(crls).values({
        id: crlId,
        caId: caId,
        crlNumber: nextCrlNumber,
        thisUpdate: thisUpdate,
        nextUpdate: nextUpdate,
        crlPem: crlPem,
        revokedCount: revokedCerts.length,
        createdAt: new Date(),
      } as any);

      // Create audit log entry
      await createAuditLog({
        db: ctx.db,
        operation: 'crl.generate',
        entityType: 'crl',
        entityId: crlId,
        status: 'success',
        details: {
          caId: caId,
          crlNumber: nextCrlNumber,
          revokedCount: revokedCerts.length,
          thisUpdate: thisUpdate.toISOString(),
          nextUpdate: nextUpdate.toISOString(),
          note: 'CRL metadata created; signing with KMS-stored keys not yet implemented',
        },
        ipAddress: ctx.ipAddress,
      });

      logger.info(
        {
          crlId,
          caId,
          crlNumber: nextCrlNumber,
          revokedCount: revokedCerts.length,
        },
        'CRL generated successfully'
      );

      return {
        id: crlId,
        crlNumber: nextCrlNumber,
        thisUpdate: thisUpdate.toISOString(),
        nextUpdate: nextUpdate.toISOString(),
        revokedCount: revokedCerts.length,
        note: 'CRL metadata created; full signing implementation requires KMS enhancement',
      };
    } catch (error) {
      logger.error({ error, caId, crlId }, 'Failed to generate CRL');

      // Log failure to audit log
      await createAuditLog({
        db: ctx.db,
        operation: 'crl.generate',
        entityType: 'crl',
        entityId: crlId,
        status: 'failure',
        details: {
          error: error instanceof Error ? error.message : String(error),
          caId: caId,
        },
        ipAddress: ctx.ipAddress,
      });

      throw new CRLOperationError('generate', error);
    }
  }

  /**
   * Get latest CRL or specific CRL by number for a CA
   */
  async getLatest(ctx: ServiceContext, params: GetCRLParams): Promise<CRLDetails | null> {
    const { caId, crlNumber } = params;

    // Verify CA exists
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CRLCANotFoundError(caId);
    }

    let crl;

    if (crlNumber !== undefined) {
      // Get specific CRL by number
      const result = await ctx.db
        .select()
        .from(crls)
        .where(and(eq(crls.caId, caId), eq(crls.crlNumber, crlNumber))!)
        .limit(1);

      if (!result || result.length === 0) {
        throw new CRLNotFoundError(caId, crlNumber);
      }

      crl = result[0];
    } else {
      // Get latest CRL
      const result = await ctx.db
        .select()
        .from(crls)
        .where(eq(crls.caId, caId))
        .orderBy(desc(crls.crlNumber))
        .limit(1);

      if (!result || result.length === 0) {
        return null; // No CRL generated yet
      }

      crl = result[0];
    }

    // Compute validity status
    const now = new Date();
    const validityStatus: 'valid' | 'expired' = now > crl.nextUpdate ? 'expired' : 'valid';

    // Get revoked certificates for this CA (for the list)
    const revokedCerts = await ctx.db
      .select({
        serialNumber: certificates.serialNumber,
        revocationDate: certificates.revocationDate,
        revocationReason: certificates.revocationReason,
      })
      .from(certificates)
      .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked'))!);

    return {
      id: crl.id,
      caId: crl.caId,
      crlNumber: crl.crlNumber,
      thisUpdate: crl.thisUpdate.toISOString(),
      nextUpdate: crl.nextUpdate.toISOString(),
      validityStatus,
      revokedCount: crl.revokedCount,
      crlPem: crl.crlPem || null,
      crlDer: crl.crlPem ? Buffer.from(crl.crlPem).toString('base64') : null,
      revokedCertificates: revokedCerts.map((cert: any) => ({
        serialNumber: cert.serialNumber,
        revocationDate: cert.revocationDate?.toISOString() || null,
        revocationReason: cert.revocationReason || null,
      })),
      createdAt: crl.createdAt.toISOString(),
    };
  }

  /**
   * List CRLs for a CA with pagination
   */
  async list(ctx: ServiceContext, params: ListCRLsParams): Promise<ListCRLsResult> {
    const { caId, limit = 50, offset = 0 } = params;

    // Verify CA exists
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CRLCANotFoundError(caId);
    }

    // Get CRLs for this CA with pagination (most recent first)
    const crlList = await ctx.db
      .select()
      .from(crls)
      .where(eq(crls.caId, caId))
      .orderBy(desc(crls.crlNumber))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await ctx.db
      .select({ count: sql`count(*)` })
      .from(crls)
      .where(eq(crls.caId, caId));
    const totalCount = Number(countResult[0]?.count || 0);

    const now = new Date();

    const formattedCrls = crlList.map((crl: any) => {
      const validityStatus: 'valid' | 'expired' = now > crl.nextUpdate ? 'expired' : 'valid';

      return {
        id: crl.id,
        crlNumber: crl.crlNumber,
        thisUpdate: crl.thisUpdate.toISOString(),
        nextUpdate: crl.nextUpdate.toISOString(),
        validityStatus,
        revokedCount: crl.revokedCount,
        createdAt: crl.createdAt.toISOString(),
      };
    });

    return {
      items: formattedCrls,
      totalCount,
      limit,
      offset,
    };
  }
}

// Custom Error Classes
export class CRLCANotFoundError extends Error {
  constructor(public caId: string) {
    super(`CA with ID ${caId} not found`);
    this.name = 'CRLCANotFoundError';
  }
}

export class CRLNotFoundError extends Error {
  constructor(public caId: string, public crlNumber: number) {
    super(`CRL number ${crlNumber} not found for CA ${caId}`);
    this.name = 'CRLNotFoundError';
  }
}

export class CRLInvalidCAStatusError extends Error {
  constructor(public caId: string, public status: string) {
    super(`Cannot generate CRL for CA with status: ${status}`);
    this.name = 'CRLInvalidCAStatusError';
  }
}

export class CRLOperationError extends Error {
  constructor(public operation: string, public cause: unknown) {
    super(`Failed to ${operation} CRL: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CRLOperationError';
  }
}

// Singleton instance
let crlServiceInstance: CRLService | null = null;

export function getCRLService(): CRLService {
  if (!crlServiceInstance) {
    crlServiceInstance = new CRLService();
  }
  return crlServiceInstance;
}

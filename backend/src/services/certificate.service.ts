import { randomUUID } from 'crypto';
import { eq, and, or, gte, lte, like, sql } from 'drizzle-orm';
import forge from 'node-forge';
import { certificates, certificateAuthorities, auditLog } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { formatDN } from '../crypto/dn.js';
import { parseCertificate } from '../crypto/x509.js';
import {
  validateDomainName,
  validateServerSANs,
  validateCertificateValidity,
} from '../crypto/validation.js';
import { logger } from '../lib/logger.js';
import type { ServiceContext } from './types.js';

// Types for Certificate Service inputs and outputs
export interface ListCertificatesParams {
  caId?: string;
  status?: 'active' | 'revoked' | 'expired';
  certificateType?: 'server' | 'client' | 'dual' | 'code_signing' | 'email';
  domain?: string;
  expiryStatus?: 'active' | 'expired' | 'expiring_soon';
  issuedAfter?: Date;
  issuedBefore?: Date;
  expiresAfter?: Date;
  expiresBefore?: Date;
  search?: string;
  sortBy?: 'createdAt' | 'notAfter' | 'subjectDn';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface CertificateListItem {
  id: string;
  caId: string;
  subjectDn: string;
  serialNumber: string;
  certificateType: string;
  notBefore: Date;
  notAfter: Date;
  kmsKeyId: string | null;
  status: string;
  revocationDate: Date | null;
  revocationReason: string | null;
  sanDns: string[] | null;
  sanIp: string[] | null;
  sanEmail: string[] | null;
  renewedFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiryStatus: 'active' | 'expired' | 'expiring_soon';
}

export interface ListCertificatesResult {
  items: CertificateListItem[];
  totalCount: number;
  limit: number;
  offset: number;
}

export interface IssueCertificateParams {
  caId: string;
  subject: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  certificateType: 'server' | 'client' | 'dual' | 'code_signing' | 'email';
  keyAlgorithm: string;
  validityDays: number;
  sanDns?: string[];
  sanIp?: string[];
  sanEmail?: string[];
  tags?: string[];
}

export interface IssueCertificateResult {
  id: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  certificatePem: string;
  status: 'active';
}

export interface RenewCertificateParams {
  id: string;
  generateNewKey?: boolean;
  validityDays?: number;
  updateInfo?: boolean;
  subject?: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  sanDns?: string[];
  sanIp?: string[];
  sanEmail?: string[];
  revokeOriginal?: boolean;
}

export interface RenewCertificateResult {
  id: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  certificatePem: string;
  status: 'active';
  renewedFromId: string;
}

export interface RevokeCertificateParams {
  id: string;
  reason: string;
  details?: string;
  effectiveDate?: number;
  generateCrl?: boolean;
}

export interface RevokeCertificateResult {
  id: string;
  status: 'revoked';
  revocationDate: string;
  revocationReason: string;
}

export interface DeleteCertificateParams {
  id: string;
  destroyKey?: boolean;
  removeFromCrl?: boolean;
  // forceDelete skips revocation/expiration checks, used for orphaned records
  forceDelete?: boolean;
}

export interface DeleteCertificateResult {
  id: string;
  deleted: boolean;
  kmsKeyDestroyed: boolean;
}

export interface DownloadCertificateParams {
  id: string;
  format: string;
  password?: string;
  encryptPrivateKey?: boolean;
  includeChain?: boolean;
}

export interface DownloadCertificateResult {
  data: string;
  mimeType: string;
  filename: string;
}

// Re-export ServiceContext for consumers that import from this module
export type { ServiceContext };

/**
 * Build X.509 v3 extensions string for certificate signing
 * Format follows OpenSSL config file syntax for Cosmian KMS
 */
export function buildCertificateExtensions(params: {
  certificateType: 'server' | 'client' | 'dual' | 'code_signing' | 'email';
  sanDns?: string[];
  sanIp?: string[];
  sanEmail?: string[];
}): string {
  // KMS expects 'v3_ca' section name for extensions
  const lines: string[] = ['[ v3_ca ]'];

  // Basic Constraints - all end-entity certificates are CA:FALSE
  lines.push('basicConstraints=critical,CA:FALSE');

  // Key Usage and Extended Key Usage based on certificate type
  switch (params.certificateType) {
    case 'server':
      lines.push('keyUsage=critical,digitalSignature,keyEncipherment');
      lines.push('extendedKeyUsage=serverAuth');
      break;
    case 'client':
      lines.push('keyUsage=critical,digitalSignature');
      lines.push('extendedKeyUsage=clientAuth');
      break;
    case 'dual':
      lines.push('keyUsage=critical,digitalSignature,keyEncipherment');
      lines.push('extendedKeyUsage=serverAuth,clientAuth');
      break;
    case 'code_signing':
      lines.push('keyUsage=critical,digitalSignature');
      lines.push('extendedKeyUsage=codeSigning');
      break;
    case 'email':
      lines.push('keyUsage=critical,digitalSignature,keyEncipherment,nonRepudiation');
      lines.push('extendedKeyUsage=emailProtection');
      break;
  }

  // Subject Alternative Names
  const sanParts: string[] = [];

  if (params.sanDns && params.sanDns.length > 0) {
    for (const dns of params.sanDns) {
      sanParts.push(`DNS:${dns}`);
    }
  }

  if (params.sanIp && params.sanIp.length > 0) {
    for (const ip of params.sanIp) {
      sanParts.push(`IP:${ip}`);
    }
  }

  if (params.sanEmail && params.sanEmail.length > 0) {
    for (const email of params.sanEmail) {
      sanParts.push(`email:${email}`);
    }
  }

  if (sanParts.length > 0) {
    lines.push(`subjectAltName=${sanParts.join(',')}`);
  }

  // Standard extensions for certificate chain validation
  lines.push('subjectKeyIdentifier=hash');
  lines.push('authorityKeyIdentifier=keyid:always');

  return lines.join('\n') + '\n';
}

/**
 * Certificate Service - Business logic for Certificate operations
 * Shared between tRPC and REST API layers
 */
export class CertificateService {
  /**
   * List certificates with filtering, sorting, and pagination
   */
  async list(ctx: ServiceContext, params?: ListCertificatesParams): Promise<ListCertificatesResult> {
    const {
      caId,
      status,
      certificateType,
      domain,
      expiryStatus,
      issuedAfter,
      issuedBefore,
      expiresAfter,
      expiresBefore,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      limit = 50,
      offset = 0,
    } = params || {};

    // Build where conditions
    const whereConditions = [];

    if (caId) {
      whereConditions.push(eq(certificates.caId, caId));
    }
    if (status) {
      whereConditions.push(eq(certificates.status, status));
    }
    if (certificateType) {
      whereConditions.push(eq(certificates.certificateType, certificateType));
    }

    // Date range filters
    if (issuedAfter) {
      whereConditions.push(gte(certificates.notBefore, issuedAfter));
    }
    if (issuedBefore) {
      whereConditions.push(lte(certificates.notBefore, issuedBefore));
    }
    if (expiresAfter) {
      whereConditions.push(gte(certificates.notAfter, expiresAfter));
    }
    if (expiresBefore) {
      whereConditions.push(lte(certificates.notAfter, expiresBefore));
    }

    // Expiry status filter
    if (expiryStatus) {
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      if (expiryStatus === 'expired') {
        whereConditions.push(lte(certificates.notAfter, now));
      } else if (expiryStatus === 'expiring_soon') {
        whereConditions.push(
          and(
            gte(certificates.notAfter, now),
            lte(certificates.notAfter, thirtyDaysFromNow)
          )!
        );
      } else if (expiryStatus === 'active') {
        whereConditions.push(gte(certificates.notAfter, thirtyDaysFromNow));
      }
    }

    // Domain filter
    if (domain) {
      whereConditions.push(
        or(
          like(certificates.subjectDn, `%CN=${domain}%`),
          like(certificates.sanDns, `%${domain}%`)
        )!
      );
    }

    // Search functionality
    if (search) {
      whereConditions.push(
        or(
          like(certificates.subjectDn, `%${search}%`),
          like(certificates.serialNumber, `%${search}%`),
          like(certificates.sanDns, `%${search}%`),
          like(certificates.sanIp, `%${search}%`),
          like(certificates.sanEmail, `%${search}%`)
        )!
      );
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Get total count
    const countResult = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(certificates)
      .where(whereClause);
    const totalCount = countResult[0]?.count || 0;

    // Build order by clause
    const orderByColumn = certificates[sortBy as keyof typeof certificates];
    const orderByClause = sortOrder === 'asc'
      ? sql`${orderByColumn} ASC`
      : sql`${orderByColumn} DESC`;

    // Execute query with pagination
    const results = await ctx.db
      .select()
      .from(certificates)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Compute expiry status for each result
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const formattedResults = results.map((cert: any) => {
      let computedExpiryStatus: 'active' | 'expired' | 'expiring_soon';
      if (cert.notAfter < now) {
        computedExpiryStatus = 'expired';
      } else if (cert.notAfter <= thirtyDaysFromNow) {
        computedExpiryStatus = 'expiring_soon';
      } else {
        computedExpiryStatus = 'active';
      }

      return {
        ...cert,
        expiryStatus: computedExpiryStatus,
        sanDns: cert.sanDns ? JSON.parse(cert.sanDns) : null,
        sanIp: cert.sanIp ? JSON.parse(cert.sanIp) : null,
        sanEmail: cert.sanEmail ? JSON.parse(cert.sanEmail) : null,
      };
    });

    return {
      items: formattedResults,
      totalCount,
      limit,
      offset,
    };
  }

  /**
   * Get certificate by ID with full details
   */
  async getById(ctx: ServiceContext, id: string): Promise<any> {
    // Query certificate with CA join
    const result = await ctx.db
      .select({
        certificate: certificates,
        ca: certificateAuthorities,
      })
      .from(certificates)
      .leftJoin(certificateAuthorities, eq(certificates.caId, certificateAuthorities.id))
      .where(eq(certificates.id, id))
      .limit(1);

    if (!result || result.length === 0) {
      throw new CertificateNotFoundError(id);
    }

    const { certificate, ca } = result[0];

    if (!ca) {
      throw new CertificateNoCAError(id);
    }

    // Fetch certificate from KMS
    const kmsService = getKMSService();
    let certificatePem: string;
    try {
      certificatePem = await kmsService.getCertificate(
        certificate.kmsCertificateId,
        certificate.id
      );
    } catch (kmsError) {
      // Certificate exists in DB but not found in KMS - data inconsistency
      logger.warn(
        { certId: id, kmsCertificateId: certificate.kmsCertificateId, error: kmsError },
        'Certificate exists in database but certificate not found in KMS - data inconsistency detected'
      );
      throw new CertificateKmsInconsistencyError(
        id,
        kmsError instanceof Error ? kmsError.message : String(kmsError),
        {
          kmsCertificateId: certificate.kmsCertificateId,
          subjectDn: certificate.subjectDn,
          serialNumber: certificate.serialNumber,
        }
      );
    }

    // Parse certificate to extract details
    const parsed = parseCertificate(certificatePem, 'PEM');

    // Parse certificate using node-forge for extensions
    const forgeCert = forge.pki.certificateFromPem(certificatePem);

    // Calculate fingerprints
    const certDer = forge.asn1.toDer(
      forge.pki.certificateToAsn1(forgeCert)
    ).getBytes();
    const sha256Hash = forge.md.sha256.create();
    sha256Hash.update(certDer);
    const sha256Fingerprint = sha256Hash
      .digest()
      .toHex()
      .toUpperCase()
      .match(/.{1,2}/g)!
      .join(':');

    const sha1Hash = forge.md.sha1.create();
    sha1Hash.update(certDer);
    const sha1Fingerprint = sha1Hash
      .digest()
      .toHex()
      .toUpperCase()
      .match(/.{1,2}/g)!
      .join(':');

    // Parse Key Usage extension
    let keyUsage: any = null;
    const keyUsageExt = forgeCert.extensions.find((ext: any) => ext.name === 'keyUsage');
    if (keyUsageExt) {
      keyUsage = {
        digitalSignature: keyUsageExt.digitalSignature || undefined,
        nonRepudiation: keyUsageExt.nonRepudiation || undefined,
        keyEncipherment: keyUsageExt.keyEncipherment || undefined,
        dataEncipherment: keyUsageExt.dataEncipherment || undefined,
        keyAgreement: keyUsageExt.keyAgreement || undefined,
        keyCertSign: keyUsageExt.keyCertSign || undefined,
        cRLSign: keyUsageExt.cRLSign || undefined,
        encipherOnly: keyUsageExt.encipherOnly || undefined,
        decipherOnly: keyUsageExt.decipherOnly || undefined,
      };
    }

    // Parse Extended Key Usage extension
    let extendedKeyUsage: string[] | null = null;
    const ekuExt = forgeCert.extensions.find((ext: any) => ext.name === 'extKeyUsage');
    if (ekuExt) {
      extendedKeyUsage = [];
      if (ekuExt.serverAuth) extendedKeyUsage.push('serverAuth');
      if (ekuExt.clientAuth) extendedKeyUsage.push('clientAuth');
      if (ekuExt.codeSigning) extendedKeyUsage.push('codeSigning');
      if (ekuExt.emailProtection) extendedKeyUsage.push('emailProtection');
      if (ekuExt.timeStamping) extendedKeyUsage.push('timeStamping');
    }

    // Parse Basic Constraints extension
    let basicConstraints: any = null;
    const bcExt = forgeCert.extensions.find((ext: any) => ext.name === 'basicConstraints');
    if (bcExt) {
      basicConstraints = {
        cA: bcExt.cA || false,
        pathLenConstraint: bcExt.pathLenConstraint ?? null,
      };
    }

    // Compute validity status
    const now = new Date();
    let validityStatus: 'valid' | 'expired' | 'not_yet_valid';
    let remainingDays: number | null = null;

    if (now < parsed.validity.notBefore) {
      validityStatus = 'not_yet_valid';
    } else if (now > parsed.validity.notAfter) {
      validityStatus = 'expired';
      remainingDays = 0;
    } else {
      validityStatus = 'valid';
      const diffMs = parsed.validity.notAfter.getTime() - now.getTime();
      remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    // Query for certificates renewed from this one
    const renewedCerts = await ctx.db
      .select({
        id: certificates.id,
        serialNumber: certificates.serialNumber,
        createdAt: certificates.createdAt,
      })
      .from(certificates)
      .where(eq(certificates.renewedFromId, certificate.id));

    // Convert subject to the expected format
    const subject = {
      commonName: parsed.subject.CN || '',
      organization: parsed.subject.O || '',
      organizationalUnit: parsed.subject.OU,
      country: parsed.subject.C || '',
      state: parsed.subject.ST,
      locality: parsed.subject.L,
    };

    // Convert issuer to the expected format
    const issuer = {
      commonName: parsed.issuer.CN,
      organization: parsed.issuer.O,
      organizationalUnit: parsed.issuer.OU,
      country: parsed.issuer.C,
      state: parsed.issuer.ST,
      locality: parsed.issuer.L,
    };

    return {
      id: certificate.id,
      caId: certificate.caId,
      serialNumber: certificate.serialNumber,
      certificateType: certificate.certificateType,
      status: certificate.status,
      subjectDn: certificate.subjectDn,
      subject,
      issuerDn: ca.subjectDn,
      issuer,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      validityStatus,
      remainingDays,
      keyUsage,
      extendedKeyUsage,
      sanDns: certificate.sanDns ? JSON.parse(certificate.sanDns) : null,
      sanIp: certificate.sanIp ? JSON.parse(certificate.sanIp) : null,
      sanEmail: certificate.sanEmail ? JSON.parse(certificate.sanEmail) : null,
      basicConstraints,
      fingerprints: {
        sha256: sha256Fingerprint,
        sha1: sha1Fingerprint,
      },
      issuingCA: {
        id: ca.id,
        subjectDn: ca.subjectDn,
        serialNumber: ca.serialNumber,
      },
      certificatePem: certificatePem,
      kmsKeyId: certificate.kmsKeyId,
      revocationDate: certificate.revocationDate,
      revocationReason: certificate.revocationReason,
      renewedFromId: certificate.renewedFromId,
      renewedTo: renewedCerts.length > 0 ? renewedCerts : null,
      createdAt: certificate.createdAt,
      updatedAt: certificate.updatedAt,
    };
  }

  /**
   * Issue a new certificate
   */
  async issue(ctx: ServiceContext, params: IssueCertificateParams): Promise<IssueCertificateResult> {
    // Type-specific validation
    switch (params.certificateType) {
      case 'server':
        const serverValidityCheck = validateCertificateValidity(params.validityDays, 825);
        if (!serverValidityCheck.valid) {
          throw new CertificateValidationError(serverValidityCheck.error || 'Invalid validity period');
        }

        const cnValidation = validateDomainName(params.subject.commonName);
        if (!cnValidation.valid) {
          throw new CertificateValidationError(`Invalid common name: ${cnValidation.error}`);
        }

        const sansValidation = validateServerSANs(params.sanDns, params.sanIp);
        if (!sansValidation.valid) {
          throw new CertificateValidationError(`Invalid SANs: ${sansValidation.errors.join(', ')}`);
        }
        break;

      case 'client':
        const clientValidityCheck = validateCertificateValidity(params.validityDays, 730);
        if (!clientValidityCheck.valid) {
          throw new CertificateValidationError(clientValidityCheck.error || 'Invalid validity period');
        }

        const cn = params.subject.commonName;
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cn);
        const isUsername = /^[a-zA-Z0-9_-]+$/.test(cn);
        const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(cn);
        if (!isEmail && !isUsername && !isHostname) {
          throw new CertificateValidationError('Client certificate CN must be a valid email address, username, or hostname');
        }

        if (params.sanEmail && params.sanEmail.length > 0) {
          for (const email of params.sanEmail) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              throw new CertificateValidationError(`Invalid email in SANs: ${email}`);
            }
          }
        }
        break;

      case 'dual':
        // Dual certificates combine server and client auth - use server validation rules
        const dualValidityCheck = validateCertificateValidity(params.validityDays, 825);
        if (!dualValidityCheck.valid) {
          throw new CertificateValidationError(dualValidityCheck.error || 'Invalid validity period');
        }

        const dualCnValidation = validateDomainName(params.subject.commonName);
        if (!dualCnValidation.valid) {
          throw new CertificateValidationError(`Invalid common name: ${dualCnValidation.error}`);
        }

        const dualSansValidation = validateServerSANs(params.sanDns, params.sanIp);
        if (!dualSansValidation.valid) {
          throw new CertificateValidationError(`Invalid SANs: ${dualSansValidation.errors.join(', ')}`);
        }
        break;

      case 'code_signing':
        if (!params.subject.organization) {
          throw new CertificateValidationError('Organization is required for code signing certificates');
        }

        const codeSignValidityCheck = validateCertificateValidity(params.validityDays, 1095);
        if (!codeSignValidityCheck.valid) {
          throw new CertificateValidationError(codeSignValidityCheck.error || 'Invalid validity period');
        }

        if (params.keyAlgorithm === 'RSA-2048') {
          throw new CertificateValidationError('Code signing certificates require RSA-3072, RSA-4096, or ECDSA-P256 minimum');
        }
        break;

      case 'email':
        const emailAddresses = params.sanEmail || [];
        if (emailAddresses.length === 0) {
          throw new CertificateValidationError('Email protection certificates require at least one email address in SANs');
        }

        const domains = emailAddresses.map(email => email.split('@')[1]);
        const uniqueDomains = [...new Set(domains)];
        if (uniqueDomains.length > 1) {
          throw new CertificateValidationError('All email addresses must be from the same domain');
        }

        const emailValidityCheck = validateCertificateValidity(params.validityDays, 730);
        if (!emailValidityCheck.valid) {
          throw new CertificateValidationError(emailValidityCheck.error || 'Invalid validity period');
        }
        break;

      default:
        throw new CertificateValidationError(`Unsupported certificate type: ${params.certificateType}`);
    }

    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, params.caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CertificateCANotFoundError(params.caId);
    }

    const caRecord = ca[0];
    const now = new Date();

    // Validate CA is active and not expired
    if (caRecord.status !== 'active') {
      throw new CertificateCANotActiveError(params.caId, caRecord.status);
    }

    if (now > caRecord.notAfter) {
      throw new CertificateCAExpiredError(params.caId);
    }

    const certId = randomUUID();
    const kmsService = getKMSService();

    try {
      // Convert API schema DN to crypto DN format
      const subjectDN = {
        CN: params.subject.commonName,
        O: params.subject.organization,
        OU: params.subject.organizationalUnit,
        C: params.subject.country,
        ST: params.subject.state,
        L: params.subject.locality,
      };

      // Determine key size from algorithm
      let keySizeInBits = 2048;
      if (params.keyAlgorithm === 'RSA-4096') {
        keySizeInBits = 4096;
      }

      // Generate key pair in KMS
      logger.info({ certId, keyAlgorithm: params.keyAlgorithm }, 'Creating certificate key pair in KMS');
      const keyPair = await kmsService.createKeyPair({
        sizeInBits: keySizeInBits,
        tags: params.tags || [],
        purpose: 'certificate',
        entityId: certId,
      });

      const subjectName = formatDN(subjectDN);
      logger.info({ certId, subjectName, caId: params.caId }, 'Signing certificate via KMS');

      // Build X.509 v3 extensions including SANs
      const x509Extensions = buildCertificateExtensions({
        certificateType: params.certificateType,
        sanDns: params.sanDns,
        sanIp: params.sanIp,
        sanEmail: params.sanEmail,
      });

      const certInfo = await kmsService.signCertificate({
        publicKeyId: keyPair.publicKeyId,
        issuerPrivateKeyId: caRecord.kmsKeyId,
        issuerCertificateId: caRecord.kmsCertificateId,
        issuerName: caRecord.subjectDn,
        subjectName: subjectName,
        daysValid: params.validityDays,
        tags: params.tags || [],
        entityId: certId,
        x509Extensions,
      });

      // Convert certificate data from hex to PEM
      const certDataHex = certInfo.certificateData;
      const certDataBuffer = Buffer.from(certDataHex, 'hex');
      const certBase64 = certDataBuffer.toString('base64');
      const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

      // Parse certificate to extract metadata
      const certMetadata = parseCertificate(certificatePem, 'PEM');

      // Store certificate in database
      await ctx.db.insert(certificates).values({
        id: certId,
        caId: params.caId,
        subjectDn: subjectName,
        serialNumber: certMetadata.serialNumber,
        certificateType: params.certificateType,
        notBefore: certMetadata.validity.notBefore,
        notAfter: certMetadata.validity.notAfter,
        kmsCertificateId: certInfo.certificateId,
        kmsKeyId: keyPair.privateKeyId,
        status: 'active',
        sanDns: params.sanDns ? JSON.stringify(params.sanDns) : null,
        sanIp: params.sanIp ? JSON.stringify(params.sanIp) : null,
        sanEmail: params.sanEmail ? JSON.stringify(params.sanEmail) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.issue',
        entityType: 'certificate',
        entityId: certId,
        status: 'success',
        details: JSON.stringify({
          caId: params.caId,
          certificateType: params.certificateType,
          subject: subjectName,
          keyAlgorithm: params.keyAlgorithm,
          validityDays: params.validityDays,
          serialNumber: certMetadata.serialNumber,
          kmsKeyId: keyPair.privateKeyId,
          sanDns: params.sanDns,
          sanIp: params.sanIp,
          sanEmail: params.sanEmail,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      logger.info({ certId, subjectName, caId: params.caId }, 'Certificate issued successfully');

      return {
        id: certId,
        subject: subjectName,
        serialNumber: certMetadata.serialNumber,
        notBefore: certMetadata.validity.notBefore.toISOString(),
        notAfter: certMetadata.validity.notAfter.toISOString(),
        certificatePem: certificatePem,
        status: 'active',
      };
    } catch (error) {
      logger.error({ error, certId }, 'Failed to issue certificate');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.issue',
        entityType: 'certificate',
        entityId: certId,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          caId: params.caId,
          certificateType: params.certificateType,
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

      throw new CertificateOperationError('issue', error);
    }
  }

  /**
   * Renew a certificate
   */
  async renew(ctx: ServiceContext, params: RenewCertificateParams): Promise<RenewCertificateResult> {
    // Fetch original certificate
    const originalCertResult = await ctx.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, params.id))
      .limit(1);

    if (!originalCertResult || originalCertResult.length === 0) {
      throw new CertificateNotFoundError(params.id);
    }

    const originalCert = originalCertResult[0];

    // Validation: Cannot renew revoked certificates
    if (originalCert.status === 'revoked') {
      throw new CertificateRevokedError(params.id);
    }

    // Validation: Key reuse only if original certificate is less than 90 days old
    if (!params.generateNewKey) {
      const certAgeMs = Date.now() - originalCert.createdAt.getTime();
      const certAgeDays = certAgeMs / (1000 * 60 * 60 * 24);
      if (certAgeDays >= 90) {
        throw new CertificateKeyReuseError(params.id);
      }
    }

    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, originalCert.caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new CertificateCANotFoundError(originalCert.caId);
    }

    const caRecord = ca[0];
    const now = new Date();

    // Validate CA is active and not expired
    if (caRecord.status !== 'active') {
      throw new CertificateCANotActiveError(originalCert.caId, caRecord.status);
    }

    if (now > caRecord.notAfter) {
      throw new CertificateCAExpiredError(originalCert.caId);
    }

    const newCertId = randomUUID();
    const kmsService = getKMSService();

    try {
      // Fetch original certificate from KMS
      const originalCertificatePem = await kmsService.getCertificate(
        originalCert.kmsCertificateId,
        originalCert.id
      );

      // Parse original certificate to extract metadata
      const originalParsed = parseCertificate(originalCertificatePem, 'PEM');

      // Determine subject DN
      let subjectDN;
      if (params.updateInfo && params.subject) {
        subjectDN = {
          CN: params.subject.commonName,
          O: params.subject.organization,
          OU: params.subject.organizationalUnit,
          C: params.subject.country,
          ST: params.subject.state,
          L: params.subject.locality,
        };
      } else {
        subjectDN = originalParsed.subject;
      }

      // Determine SANs
      let sanDns = params.updateInfo && params.sanDns !== undefined ? params.sanDns :
                   (originalCert.sanDns ? JSON.parse(originalCert.sanDns) : null);
      let sanIp = params.updateInfo && params.sanIp !== undefined ? params.sanIp :
                  (originalCert.sanIp ? JSON.parse(originalCert.sanIp) : null);
      let sanEmail = params.updateInfo && params.sanEmail !== undefined ? params.sanEmail :
                     (originalCert.sanEmail ? JSON.parse(originalCert.sanEmail) : null);

      // Determine validity days
      const validityDays = params.validityDays ||
        Math.ceil((originalCert.notAfter.getTime() - originalCert.notBefore.getTime()) / (1000 * 60 * 60 * 24));

      // Always generate a new key pair for renewal
      // Key reuse is not supported because we don't store the public key ID separately,
      // and deriving it from the private key ID is unreliable
      if (!params.generateNewKey) {
        logger.warn({ newCertId, originalCertId: params.id },
          'Key reuse requested but not supported - generating new key pair instead');
      }

      logger.info({ newCertId, originalCertId: params.id }, 'Creating new key pair for certificate renewal');

      const keyPair = await kmsService.createKeyPair({
        sizeInBits: 2048,
        tags: [],
        purpose: 'certificate',
        entityId: newCertId,
      });

      const kmsKeyId = keyPair.privateKeyId;
      const publicKeyId = keyPair.publicKeyId;

      const subjectName = formatDN(subjectDN);
      logger.info({ newCertId, subjectName, caId: originalCert.caId }, 'Signing renewed certificate via KMS');

      // Build X.509 v3 extensions including SANs
      const x509Extensions = buildCertificateExtensions({
        certificateType: originalCert.certificateType as 'server' | 'client' | 'code_signing' | 'email',
        sanDns: sanDns || undefined,
        sanIp: sanIp || undefined,
        sanEmail: sanEmail || undefined,
      });

      const certInfo = await kmsService.signCertificate({
        publicKeyId: publicKeyId,
        issuerPrivateKeyId: caRecord.kmsKeyId,
        issuerCertificateId: caRecord.kmsCertificateId,
        issuerName: caRecord.subjectDn,
        subjectName: subjectName,
        daysValid: validityDays,
        tags: [],
        entityId: newCertId,
        x509Extensions,
      });

      // Convert certificate data from hex to PEM
      const certDataHex = certInfo.certificateData;
      const certDataBuffer = Buffer.from(certDataHex, 'hex');
      const certBase64 = certDataBuffer.toString('base64');
      const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

      // Parse new certificate to extract metadata
      const certMetadata = parseCertificate(certificatePem, 'PEM');

      // Store new certificate in database
      await ctx.db.insert(certificates).values({
        id: newCertId,
        caId: originalCert.caId,
        subjectDn: subjectName,
        serialNumber: certMetadata.serialNumber,
        certificateType: originalCert.certificateType,
        notBefore: certMetadata.validity.notBefore,
        notAfter: certMetadata.validity.notAfter,
        kmsCertificateId: certInfo.certificateId,
        kmsKeyId: kmsKeyId, // Always store since we always generate new keys
        status: 'active',
        sanDns: sanDns ? JSON.stringify(sanDns) : null,
        sanIp: sanIp ? JSON.stringify(sanIp) : null,
        sanEmail: sanEmail ? JSON.stringify(sanEmail) : null,
        renewedFromId: params.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Optionally revoke the original certificate
      if (params.revokeOriginal) {
        await ctx.db
          .update(certificates)
          .set({
            status: 'revoked',
            revocationDate: new Date(),
            revocationReason: 'superseded',
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, params.id));

        logger.info({ originalCertId: params.id }, 'Original certificate revoked (superseded by renewal)');
      }

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.renew',
        entityType: 'certificate',
        entityId: newCertId,
        status: 'success',
        details: JSON.stringify({
          originalCertId: params.id,
          caId: originalCert.caId,
          certificateType: originalCert.certificateType,
          subject: subjectName,
          validityDays: validityDays,
          serialNumber: certMetadata.serialNumber,
          kmsKeyId: kmsKeyId,
          generateNewKey: params.generateNewKey,
          updateInfo: params.updateInfo,
          revokeOriginal: params.revokeOriginal,
          sanDns: sanDns,
          sanIp: sanIp,
          sanEmail: sanEmail,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      logger.info({ newCertId, originalCertId: params.id }, 'Certificate renewed successfully');

      return {
        id: newCertId,
        subject: subjectName,
        serialNumber: certMetadata.serialNumber,
        notBefore: certMetadata.validity.notBefore.toISOString(),
        notAfter: certMetadata.validity.notAfter.toISOString(),
        certificatePem: certificatePem,
        status: 'active',
        renewedFromId: params.id,
      };
    } catch (error) {
      logger.error({ error, newCertId, originalCertId: params.id }, 'Failed to renew certificate');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.renew',
        entityType: 'certificate',
        entityId: newCertId,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          originalCertId: params.id,
          caId: originalCert.caId,
          certificateType: originalCert.certificateType,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CertificateOperationError('renew', error);
    }
  }

  /**
   * Revoke a certificate
   */
  async revoke(ctx: ServiceContext, params: RevokeCertificateParams): Promise<RevokeCertificateResult> {
    // Fetch certificate from database
    const certResult = await ctx.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, params.id))
      .limit(1);

    if (!certResult || certResult.length === 0) {
      throw new CertificateNotFoundError(params.id);
    }

    const cert = certResult[0];

    // Validation: Cannot revoke already revoked certificate
    if (cert.status === 'revoked') {
      throw new CertificateAlreadyRevokedError(params.id);
    }

    // Determine effective date
    const effectiveDate = params.effectiveDate
      ? new Date(params.effectiveDate * 1000)
      : new Date();

    // Validate effective date
    const now = new Date();
    if (effectiveDate < cert.notBefore) {
      throw new CertificateValidationError('Effective date cannot be before certificate issuance date');
    }

    if (effectiveDate > now) {
      throw new CertificateValidationError('Effective date cannot be in the future');
    }

    try {
      // Update certificate status to revoked
      await ctx.db
        .update(certificates)
        .set({
          status: 'revoked',
          revocationDate: effectiveDate,
          revocationReason: params.details
            ? `${params.reason}: ${params.details}`
            : params.reason,
          updatedAt: new Date(),
        })
        .where(eq(certificates.id, params.id));

      logger.info(
        {
          certId: params.id,
          reason: params.reason,
          effectiveDate: effectiveDate.toISOString()
        },
        'Certificate revoked successfully'
      );

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.revoke',
        entityType: 'certificate',
        entityId: params.id,
        status: 'success',
        details: JSON.stringify({
          caId: cert.caId,
          serialNumber: cert.serialNumber,
          reason: params.reason,
          effectiveDate: effectiveDate.toISOString(),
          details: params.details,
          generateCrl: params.generateCrl,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      if (params.generateCrl) {
        logger.info({ caId: cert.caId }, 'CRL generation requested (not yet implemented)');
      }

      return {
        id: params.id,
        status: 'revoked',
        revocationDate: effectiveDate.toISOString(),
        revocationReason: params.details
          ? `${params.reason}: ${params.details}`
          : params.reason,
      };
    } catch (error) {
      logger.error({ error, certId: params.id }, 'Failed to revoke certificate');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.revoke',
        entityType: 'certificate',
        entityId: params.id,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          caId: cert.caId,
          serialNumber: cert.serialNumber,
          reason: params.reason,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CertificateOperationError('revoke', error);
    }
  }

  /**
   * Delete a certificate
   */
  async delete(ctx: ServiceContext, params: DeleteCertificateParams): Promise<DeleteCertificateResult> {
    // Fetch certificate from database
    const certResult = await ctx.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, params.id))
      .limit(1);

    if (!certResult || certResult.length === 0) {
      throw new CertificateNotFoundError(params.id);
    }

    const cert = certResult[0];
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Validation: Certificate must be revoked or expired > 90 days (unless forceDelete is true)
    // forceDelete allows removing orphaned DB records when KMS data is missing
    const isRevoked = cert.status === 'revoked';
    const isExpiredOverNinetyDays = cert.notAfter < ninetyDaysAgo;

    if (!params.forceDelete && !isRevoked && !isExpiredOverNinetyDays) {
      throw new CertificateNotDeletableError(params.id);
    }

    try {
      // Create audit log entry BEFORE deletion
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.delete',
        entityType: 'certificate',
        entityId: params.id,
        status: 'success',
        details: JSON.stringify({
          caId: cert.caId,
          serialNumber: cert.serialNumber,
          certificateType: cert.certificateType,
          status: cert.status,
          destroyKey: params.destroyKey,
          removeFromCrl: params.removeFromCrl,
          revocationDate: cert.revocationDate?.toISOString(),
          revocationReason: cert.revocationReason,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      // Optional: Destroy KMS key if requested
      let keyDestroyed = false;
      if (params.destroyKey && cert.kmsKeyId) {
        try {
          const kmsService = getKMSService();
          await kmsService.destroyKey(cert.kmsKeyId);
          keyDestroyed = true;
          logger.info(
            { certId: params.id, kmsKeyId: cert.kmsKeyId },
            'KMS key destroyed for deleted certificate'
          );
        } catch (error) {
          logger.warn(
            { error, certId: params.id, kmsKeyId: cert.kmsKeyId },
            'Failed to destroy KMS key, continuing with certificate deletion'
          );
        }
      }

      // Delete certificate from database
      await ctx.db
        .delete(certificates)
        .where(eq(certificates.id, params.id));

      logger.info(
        { certId: params.id, serialNumber: cert.serialNumber },
        'Certificate deleted successfully'
      );

      if (params.removeFromCrl) {
        logger.info({ caId: cert.caId }, 'CRL update requested (not yet implemented)');
      }

      return {
        id: params.id,
        deleted: true,
        kmsKeyDestroyed: params.destroyKey === true && cert.kmsKeyId !== null && keyDestroyed,
      };
    } catch (error) {
      logger.error({ error, certId: params.id }, 'Failed to delete certificate');

      // Log failure to audit log
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.delete',
        entityType: 'certificate',
        entityId: params.id,
        status: 'failure',
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          caId: cert.caId,
          serialNumber: cert.serialNumber,
        }),
        ipAddress: ctx.ipAddress,
      } as any);

      throw new CertificateOperationError('delete', error);
    }
  }
}

// Custom Error Classes
export class CertificateNotFoundError extends Error {
  constructor(public certId: string) {
    super(`Certificate with ID ${certId} not found`);
    this.name = 'CertificateNotFoundError';
  }
}

export class CertificateNoCAError extends Error {
  constructor(public certId: string) {
    super('Certificate has no associated CA');
    this.name = 'CertificateNoCAError';
  }
}

export class CertificateCANotFoundError extends Error {
  constructor(public caId: string) {
    super(`CA with ID ${caId} not found`);
    this.name = 'CertificateCANotFoundError';
  }
}

export class CertificateCANotActiveError extends Error {
  constructor(public caId: string, public status: string) {
    super(`CA is not active (status: ${status})`);
    this.name = 'CertificateCANotActiveError';
  }
}

export class CertificateCAExpiredError extends Error {
  constructor(public caId: string) {
    super('CA certificate has expired');
    this.name = 'CertificateCAExpiredError';
  }
}

export class CertificateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateValidationError';
  }
}

export class CertificateRevokedError extends Error {
  constructor(public certId: string) {
    super('Cannot renew a revoked certificate');
    this.name = 'CertificateRevokedError';
  }
}

export class CertificateAlreadyRevokedError extends Error {
  constructor(public certId: string) {
    super('Certificate is already revoked');
    this.name = 'CertificateAlreadyRevokedError';
  }
}

export class CertificateKeyReuseError extends Error {
  constructor(public certId: string) {
    super('Key reuse is only allowed for certificates less than 90 days old');
    this.name = 'CertificateKeyReuseError';
  }
}

export class CertificateNoKeyError extends Error {
  constructor(public certId: string) {
    super('Original certificate has no associated KMS key to reuse');
    this.name = 'CertificateNoKeyError';
  }
}

export class CertificateNotDeletableError extends Error {
  constructor(public certId: string) {
    super('Certificate must be revoked or expired for more than 90 days before deletion');
    this.name = 'CertificateNotDeletableError';
  }
}

export class CertificateOperationError extends Error {
  constructor(public operation: string, public cause: unknown) {
    super(`Failed to ${operation} certificate: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'CertificateOperationError';
  }
}

export class CertificateKmsInconsistencyError extends Error {
  constructor(
    public certId: string,
    public kmsError: string,
    public metadata?: {
      kmsCertificateId?: string;
      subjectDn?: string;
      serialNumber?: string;
    }
  ) {
    super(`Certificate ${certId} exists in database but certificate not found in KMS: ${kmsError}`);
    this.name = 'CertificateKmsInconsistencyError';
  }
}

// Singleton instance
let certificateServiceInstance: CertificateService | null = null;

export function getCertificateService(): CertificateService {
  if (!certificateServiceInstance) {
    certificateServiceInstance = new CertificateService();
  }
  return certificateServiceInstance;
}

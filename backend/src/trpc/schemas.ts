import { z } from 'zod';

// Common schemas
export const idSchema = z.string().min(1);
export const timestampSchema = z.number().int().positive();

// Distinguished Name schema
export const distinguishedNameSchema = z.object({
  commonName: z.string().min(1).max(64),
  organization: z.string().min(1).max(64),
  organizationalUnit: z.string().max(64).optional(),
  country: z.string().length(2),
  state: z.string().max(128).optional(),
  locality: z.string().max(128).optional(),
});

// Key algorithm schemas
export const keyAlgorithmSchema = z.enum([
  'RSA-2048',
  'RSA-4096',
  'ECDSA-P256',
  'ECDSA-P384',
]);

// Certificate status schema
export const certificateStatusSchema = z.enum(['active', 'revoked', 'expired']);

// Certificate type schema
export const certificateTypeSchema = z.enum([
  'server',
  'client',
  'code_signing',
  'email',
]);

// Revocation reason schema
export const revocationReasonSchema = z.enum([
  'unspecified',
  'keyCompromise',
  'caCompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'certificateHold',
  'privilegeWithdrawn',
]);

// CA schemas
export const createCaSchema = z.object({
  subject: distinguishedNameSchema,
  keyAlgorithm: keyAlgorithmSchema.default('RSA-4096'),
  validityYears: z.number().int().min(1).max(30).default(20),
  tags: z.array(z.string()).optional(),
});

export const listCasSchema = z
  .object({
    status: certificateStatusSchema.optional(),
    algorithm: keyAlgorithmSchema.optional(),
    search: z.string().optional(),
    sortBy: z.enum(['name', 'issuedDate', 'expiryDate']).optional().default('issuedDate'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .optional();

export const getCaSchema = z.object({
  id: idSchema,
});

export const revokeCaSchema = z.object({
  id: idSchema,
  reason: revocationReasonSchema,
  details: z.string().max(500).optional(),
});

export const deleteCaSchema = z.object({
  id: idSchema,
  destroyKey: z.boolean().default(true),
});

// Certificate schemas
export const createCertificateSchema = z.object({
  caId: idSchema,
  subject: distinguishedNameSchema,
  certificateType: certificateTypeSchema,
  keyAlgorithm: keyAlgorithmSchema.default('RSA-2048'),
  validityDays: z.number().int().min(1).max(825),
  sanDns: z.array(z.string()).optional(),
  sanIp: z.array(z.string()).optional(),
  sanEmail: z.array(z.string().email()).optional(),
  tags: z.array(z.string()).optional(),
});

export const listCertificatesSchema = z
  .object({
    // Filters
    caId: idSchema.optional(),
    status: certificateStatusSchema.optional(),
    certificateType: certificateTypeSchema.optional(),
    domain: z.string().optional(), // Filter by domain (searches in CN and SANs)
    expiryStatus: z.enum(['active', 'expired', 'expiring_soon']).optional(), // Dynamic expiry status

    // Date range filters
    issuedAfter: z.coerce.date().optional(),
    issuedBefore: z.coerce.date().optional(),
    expiresAfter: z.coerce.date().optional(),
    expiresBefore: z.coerce.date().optional(),

    // Search (searches across CN, subject, SAN, serial)
    search: z.string().optional(),

    // Sorting
    sortBy: z.enum([
      'serialNumber',
      'subjectDn',
      'notBefore',
      'notAfter',
      'certificateType',
      'status',
      'createdAt',
    ]).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),

    // Pagination
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .optional();

export const getCertificateSchema = z.object({
  id: idSchema,
});

export const renewCertificateSchema = z.object({
  id: idSchema,
  generateNewKey: z.boolean().default(true),
  validityDays: z.number().int().min(1).max(825).optional(),
  updateInfo: z.boolean().default(false),
  subject: distinguishedNameSchema.optional(),
  sanDns: z.array(z.string()).optional(),
  sanIp: z.array(z.string()).optional(),
  sanEmail: z.array(z.string().email()).optional(),
  revokeOriginal: z.boolean().default(false),
});

export const revokeCertificateSchema = z.object({
  id: idSchema,
  reason: revocationReasonSchema,
  effectiveDate: timestampSchema.optional(),
  details: z.string().max(500).optional(),
  generateCrl: z.boolean().default(true),
});

export const deleteCertificateSchema = z.object({
  id: idSchema,
  destroyKey: z.boolean().default(true),
  removeFromCrl: z.boolean().default(false),
});

export const downloadCertificateSchema = z.object({
  id: idSchema,
  format: z.enum(['pem', 'der', 'pem-chain', 'pkcs7', 'pkcs12']).default('pem'),
  password: z.string().min(8).optional(), // Required for PKCS#12
});

export const bulkCreateCertificatesSchema = z.object({
  caId: idSchema,
  defaultValidityDays: z.number().int().min(1).max(825).optional(),
  csvData: z.string().min(1),
});

// CRL schemas
export const generateCrlSchema = z.object({
  caId: idSchema,
  nextUpdateDays: z.number().int().min(1).max(30).default(7),
});

export const getCrlSchema = z.object({
  caId: idSchema,
  crlNumber: z.number().int().optional(),
});

export const listCrlsSchema = z.object({
  caId: idSchema,
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Audit log schemas
export const listAuditLogSchema = z
  .object({
    operation: z.string().optional(),
    entityType: z.string().optional(),
    entityId: idSchema.optional(),
    status: z.enum(['success', 'failure']).optional(),
    startDate: timestampSchema.optional(),
    endDate: timestampSchema.optional(),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().min(0).default(0),
  })
  .optional();

export const generateReportSchema = z.object({
  reportType: z.enum(['certificate_inventory', 'revocation', 'ca_operations']),
  format: z.enum(['csv', 'pdf']).default('csv'),
  caId: idSchema.optional(),
  startDate: timestampSchema.optional(),
  endDate: timestampSchema.optional(),
});

// Certificate detail output schema
export const certificateDetailSchema = z.object({
  // Basic fields
  id: z.string(),
  caId: z.string(),
  serialNumber: z.string(),
  certificateType: certificateTypeSchema,
  status: certificateStatusSchema,

  // Distinguished Names
  subjectDn: z.string(),
  subject: distinguishedNameSchema,
  issuerDn: z.string(),
  issuer: distinguishedNameSchema,

  // Validity
  notBefore: z.date(),
  notAfter: z.date(),
  validityStatus: z.enum(['valid', 'expired', 'not_yet_valid']),
  remainingDays: z.number().nullable(),

  // Key Usage
  keyUsage: z.object({
    digitalSignature: z.boolean().optional(),
    nonRepudiation: z.boolean().optional(),
    keyEncipherment: z.boolean().optional(),
    dataEncipherment: z.boolean().optional(),
    keyAgreement: z.boolean().optional(),
    keyCertSign: z.boolean().optional(),
    cRLSign: z.boolean().optional(),
    encipherOnly: z.boolean().optional(),
    decipherOnly: z.boolean().optional(),
  }).nullable(),

  // Extended Key Usage
  extendedKeyUsage: z.array(z.string()).nullable(),

  // Subject Alternative Names
  sanDns: z.array(z.string()).nullable(),
  sanIp: z.array(z.string()).nullable(),
  sanEmail: z.array(z.string()).nullable(),

  // Basic Constraints
  basicConstraints: z.object({
    cA: z.boolean(),
    pathLenConstraint: z.number().nullable(),
  }).nullable(),

  // Fingerprints
  fingerprints: z.object({
    sha256: z.string(),
    sha1: z.string(),
  }),

  // CA Information
  issuingCA: z.object({
    id: z.string(),
    subjectDn: z.string(),
    serialNumber: z.string(),
  }),

  // Certificate data
  certificatePem: z.string(),
  kmsKeyId: z.string().nullable(),

  // Revocation info
  revocationDate: z.date().nullable(),
  revocationReason: z.string().nullable(),

  // Renewal chain
  renewedFromId: z.string().nullable(),
  renewedTo: z.array(z.object({
    id: z.string(),
    serialNumber: z.string(),
    createdAt: z.date(),
  })).nullable(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

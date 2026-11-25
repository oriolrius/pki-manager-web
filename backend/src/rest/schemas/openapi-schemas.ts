/**
 * OpenAPI JSON Schema definitions generated from Zod schemas
 *
 * This file uses Zod to convert Zod validation schemas
 * to JSON Schema format for use in OpenAPI documentation.
 */

import { z } from 'zod';
import type { OpenAPIV3 } from 'openapi-types';
import {
  // Common schemas
  idSchema,
  timestampSchema,
  distinguishedNameSchema,
  keyAlgorithmSchema,
  certificateStatusSchema,
  certificateTypeSchema,
  revocationReasonSchema,

  // CA schemas
  createCaSchema,
  listCasSchema,
  getCaSchema,
  revokeCaSchema,
  deleteCaSchema,

  // Certificate schemas
  createCertificateSchema,
  listCertificatesSchema,
  getCertificateSchema,
  renewCertificateSchema,
  revokeCertificateSchema,
  deleteCertificateSchema,
  downloadCertificateSchema,

  // Bulk operation schemas
  bulkCreateCertificatesSchema,
  bulkRevokeCertificatesSchema,
  bulkRenewCertificatesSchema,
  bulkDeleteCertificatesSchema,
  bulkDownloadCertificatesSchema,

  // CRL schemas
  generateCrlSchema,
  getCrlSchema,
  listCrlsSchema,

  // Audit schemas
  listAuditLogSchema,
  generateReportSchema,

  // Detail schema
  certificateDetailSchema,
} from '../../trpc/schemas.js';

function toJsonSchema(schema: z.ZodType): OpenAPIV3.SchemaObject {
  const { $schema, ...definition } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: ({ zodSchema }) => zodSchema._zod.def.type === 'date'
      ? { type: 'string', format: 'date-time' }
      : 'throw',
  });
  return definition as OpenAPIV3.SchemaObject;
}

// ============================================================================
// Common/Enum Schemas
// ============================================================================

export const IdSchema = toJsonSchema(idSchema);
export const TimestampSchema = toJsonSchema(timestampSchema);
export const DistinguishedNameSchema = toJsonSchema(distinguishedNameSchema);
export const KeyAlgorithmSchema = toJsonSchema(keyAlgorithmSchema);
export const CertificateStatusSchema = toJsonSchema(certificateStatusSchema);
export const CertificateTypeSchema = toJsonSchema(certificateTypeSchema);
export const RevocationReasonSchema = toJsonSchema(revocationReasonSchema);

// ============================================================================
// CA Schemas
// ============================================================================

export const CreateCaRequestSchema = toJsonSchema(createCaSchema);
export const ListCasRequestSchema = toJsonSchema(listCasSchema);
export const GetCaRequestSchema = toJsonSchema(getCaSchema);
export const RevokeCaRequestSchema = toJsonSchema(revokeCaSchema);
export const DeleteCaRequestSchema = toJsonSchema(deleteCaSchema);

// ============================================================================
// Certificate Schemas
// ============================================================================

export const CreateCertificateRequestSchema = toJsonSchema(createCertificateSchema);
export const ListCertificatesRequestSchema = toJsonSchema(listCertificatesSchema);
export const GetCertificateRequestSchema = toJsonSchema(getCertificateSchema);
export const RenewCertificateRequestSchema = toJsonSchema(renewCertificateSchema);
export const RevokeCertificateRequestSchema = toJsonSchema(revokeCertificateSchema);
export const DeleteCertificateRequestSchema = toJsonSchema(deleteCertificateSchema);
export const DownloadCertificateRequestSchema = toJsonSchema(downloadCertificateSchema);
export const CertificateDetailSchema = toJsonSchema(certificateDetailSchema);

// ============================================================================
// Bulk Operation Schemas
// ============================================================================

export const BulkCreateCertificatesRequestSchema = toJsonSchema(bulkCreateCertificatesSchema);
export const BulkRevokeCertificatesRequestSchema = toJsonSchema(bulkRevokeCertificatesSchema);
export const BulkRenewCertificatesRequestSchema = toJsonSchema(bulkRenewCertificatesSchema);
export const BulkDeleteCertificatesRequestSchema = toJsonSchema(bulkDeleteCertificatesSchema);
export const BulkDownloadCertificatesRequestSchema = toJsonSchema(bulkDownloadCertificatesSchema);

// ============================================================================
// CRL Schemas
// ============================================================================

export const GenerateCrlRequestSchema = toJsonSchema(generateCrlSchema);
export const GetCrlRequestSchema = toJsonSchema(getCrlSchema);
export const ListCrlsRequestSchema = toJsonSchema(listCrlsSchema);

// ============================================================================
// Audit Schemas
// ============================================================================

export const ListAuditLogRequestSchema = toJsonSchema(listAuditLogSchema);
export const GenerateReportRequestSchema = toJsonSchema(generateReportSchema);

// ============================================================================
// OpenAPI Component Schemas
// These are formatted for direct use in OpenAPI spec components.schemas
// ============================================================================

export const openApiSchemas = {
  // Common/Enums
  Id: IdSchema,
  Timestamp: TimestampSchema,
  SubjectDN: DistinguishedNameSchema,
  KeyAlgorithm: KeyAlgorithmSchema,
  CertificateStatus: CertificateStatusSchema,
  CertificateType: CertificateTypeSchema,
  RevocationReason: RevocationReasonSchema,

  // CA Request Schemas
  CreateCaRequest: CreateCaRequestSchema,
  ListCasRequest: ListCasRequestSchema,
  RevokeCaRequest: RevokeCaRequestSchema,
  DeleteCaRequest: DeleteCaRequestSchema,

  // Certificate Request Schemas
  CreateCertificateRequest: CreateCertificateRequestSchema,
  ListCertificatesRequest: ListCertificatesRequestSchema,
  RenewCertificateRequest: RenewCertificateRequestSchema,
  RevokeCertificateRequest: RevokeCertificateRequestSchema,
  DeleteCertificateRequest: DeleteCertificateRequestSchema,
  DownloadCertificateRequest: DownloadCertificateRequestSchema,
  CertificateDetail: CertificateDetailSchema,

  // Bulk Operation Schemas
  BulkCreateCertificatesRequest: BulkCreateCertificatesRequestSchema,
  BulkRevokeCertificatesRequest: BulkRevokeCertificatesRequestSchema,
  BulkRenewCertificatesRequest: BulkRenewCertificatesRequestSchema,
  BulkDeleteCertificatesRequest: BulkDeleteCertificatesRequestSchema,
  BulkDownloadCertificatesRequest: BulkDownloadCertificatesRequestSchema,

  // CRL Schemas
  GenerateCrlRequest: GenerateCrlRequestSchema,
  GetCrlRequest: GetCrlRequestSchema,
  ListCrlsRequest: ListCrlsRequestSchema,

  // Audit Schemas
  ListAuditLogRequest: ListAuditLogRequestSchema,
  GenerateReportRequest: GenerateReportRequestSchema,
};

// Export type for TypeScript consumers
export type OpenApiSchemas = typeof openApiSchemas;

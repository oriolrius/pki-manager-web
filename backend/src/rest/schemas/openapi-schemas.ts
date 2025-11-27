/**
 * OpenAPI JSON Schema definitions generated from Zod schemas
 *
 * This file uses zod-to-json-schema to convert Zod validation schemas
 * to JSON Schema format for use in OpenAPI documentation.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { JsonSchema7Type } from 'zod-to-json-schema';
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

// Helper function to convert Zod schema to JSON Schema with proper typing
// Extracts the actual schema from definitions to make it OpenAPI-compatible
function toJsonSchema(schema: Parameters<typeof zodToJsonSchema>[0], name: string): JsonSchema7Type {
  const result = zodToJsonSchema(schema, {
    name,
    target: 'openApi3',
  }) as Record<string, unknown>;

  // Extract the schema from definitions if present
  if (result.definitions && typeof result.definitions === 'object') {
    const definitions = result.definitions as Record<string, unknown>;
    if (definitions[name]) {
      return definitions[name] as JsonSchema7Type;
    }
  }

  // If no $ref/definitions pattern, return the schema directly
  // But remove $schema if present (not needed in OpenAPI)
  const { $schema, definitions, $ref, ...cleanSchema } = result;
  return cleanSchema as JsonSchema7Type;
}

// ============================================================================
// Common/Enum Schemas
// ============================================================================

export const IdSchema = toJsonSchema(idSchema, 'Id');
export const TimestampSchema = toJsonSchema(timestampSchema, 'Timestamp');
export const DistinguishedNameSchema = toJsonSchema(distinguishedNameSchema, 'DistinguishedName');
export const KeyAlgorithmSchema = toJsonSchema(keyAlgorithmSchema, 'KeyAlgorithm');
export const CertificateStatusSchema = toJsonSchema(certificateStatusSchema, 'CertificateStatus');
export const CertificateTypeSchema = toJsonSchema(certificateTypeSchema, 'CertificateType');
export const RevocationReasonSchema = toJsonSchema(revocationReasonSchema, 'RevocationReason');

// ============================================================================
// CA Schemas
// ============================================================================

export const CreateCaRequestSchema = toJsonSchema(createCaSchema, 'CreateCaRequest');
export const ListCasRequestSchema = toJsonSchema(listCasSchema, 'ListCasRequest');
export const GetCaRequestSchema = toJsonSchema(getCaSchema, 'GetCaRequest');
export const RevokeCaRequestSchema = toJsonSchema(revokeCaSchema, 'RevokeCaRequest');
export const DeleteCaRequestSchema = toJsonSchema(deleteCaSchema, 'DeleteCaRequest');

// ============================================================================
// Certificate Schemas
// ============================================================================

export const CreateCertificateRequestSchema = toJsonSchema(createCertificateSchema, 'CreateCertificateRequest');
export const ListCertificatesRequestSchema = toJsonSchema(listCertificatesSchema, 'ListCertificatesRequest');
export const GetCertificateRequestSchema = toJsonSchema(getCertificateSchema, 'GetCertificateRequest');
export const RenewCertificateRequestSchema = toJsonSchema(renewCertificateSchema, 'RenewCertificateRequest');
export const RevokeCertificateRequestSchema = toJsonSchema(revokeCertificateSchema, 'RevokeCertificateRequest');
export const DeleteCertificateRequestSchema = toJsonSchema(deleteCertificateSchema, 'DeleteCertificateRequest');
export const DownloadCertificateRequestSchema = toJsonSchema(downloadCertificateSchema, 'DownloadCertificateRequest');
export const CertificateDetailSchema = toJsonSchema(certificateDetailSchema, 'CertificateDetail');

// ============================================================================
// Bulk Operation Schemas
// ============================================================================

export const BulkCreateCertificatesRequestSchema = toJsonSchema(bulkCreateCertificatesSchema, 'BulkCreateCertificatesRequest');
export const BulkRevokeCertificatesRequestSchema = toJsonSchema(bulkRevokeCertificatesSchema, 'BulkRevokeCertificatesRequest');
export const BulkRenewCertificatesRequestSchema = toJsonSchema(bulkRenewCertificatesSchema, 'BulkRenewCertificatesRequest');
export const BulkDeleteCertificatesRequestSchema = toJsonSchema(bulkDeleteCertificatesSchema, 'BulkDeleteCertificatesRequest');
export const BulkDownloadCertificatesRequestSchema = toJsonSchema(bulkDownloadCertificatesSchema, 'BulkDownloadCertificatesRequest');

// ============================================================================
// CRL Schemas
// ============================================================================

export const GenerateCrlRequestSchema = toJsonSchema(generateCrlSchema, 'GenerateCrlRequest');
export const GetCrlRequestSchema = toJsonSchema(getCrlSchema, 'GetCrlRequest');
export const ListCrlsRequestSchema = toJsonSchema(listCrlsSchema, 'ListCrlsRequest');

// ============================================================================
// Audit Schemas
// ============================================================================

export const ListAuditLogRequestSchema = toJsonSchema(listAuditLogSchema, 'ListAuditLogRequest');
export const GenerateReportRequestSchema = toJsonSchema(generateReportSchema, 'GenerateReportRequest');

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

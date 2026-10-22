import { okObjectResponse } from './ssh-openapi-schemas.js';

const string = { type: 'string' } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;
const identity = {
  ...okObjectResponse,
  properties: {
    id: string, name: string, caId: string,
    kind: { type: 'string', enum: ['kubernetes', 'scep', 'generic'] },
  },
} as const;

// Keep additionalProperties:true: documenting fields must not strip response data.
export const externalHealthResponse = {
  ...okObjectResponse,
  properties: {
    status: string,
    integration: identity,
    cluster: {
      ...okObjectResponse,
      properties: { id: string, name: string, caId: string },
      deprecated: true,
      description: 'Compatibility identity for older cert-manager clients; use integration.',
    },
    timestamp,
  },
} as const;
export const externalBundleResponse = {
  ...okObjectResponse,
  properties: { caId: string, subjectDn: string, certificatePem: string, chainPem: string },
} as const;
export const externalStatusResponse = {
  ...okObjectResponse,
  properties: {
    active: { type: 'boolean', description: 'False for missing, expired, revoked, or differently owned certificates.' },
  },
} as const;
export const externalSignResponse = {
  ...okObjectResponse,
  properties: {
    idempotent: { type: 'boolean' }, id: string, serialNumber: string,
    certificatePem: string, chainPem: string, notBefore: timestamp, notAfter: timestamp,
  },
} as const;
export const externalRevokeResponse = {
  ...okObjectResponse,
  properties: {
    id: string, serialNumber: string, status: { type: 'string', enum: ['revoked'] },
    revocationDate: timestamp,
    idempotent: { type: 'boolean', description: 'Present and true when the certificate was already revoked.' },
  },
} as const;

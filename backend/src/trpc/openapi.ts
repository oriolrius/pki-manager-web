import { generateOpenApiDocument } from 'trpc-to-openapi';
import { appRouter } from './router.js';
import { APP_VERSION } from '../lib/version.js';

const document = generateOpenApiDocument(appRouter, {
  options: {
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === 'date') Object.assign(jsonSchema, { type: 'string', format: 'date-time' });
    },
  },
  openApiVersion: '3.0.3',
  title: 'PKI Manager API',
  version: APP_VERSION,
  baseUrl: 'http://localhost:3000/api',
  description: 'Public Key Infrastructure (PKI) Management System API - Certificate Authority and Certificate Management',
  docsUrl: 'https://github.com/your-org/pki-manager',
});

export const openApiDocument: ReturnType<typeof generateOpenApiDocument> = {
  ...document,
  tags: [
    {
      name: 'certificates',
      description: 'Certificate operations - issue, list, renew, revoke, and delete certificates',
    },
    {
      name: 'ca',
      description: 'Certificate Authority operations - create, list, and manage CAs',
    },
    {
      name: 'crl',
      description: 'Certificate Revocation List operations - generate and retrieve CRLs',
    },
    {
      name: 'audit',
      description: 'Audit log operations - query system audit logs',
    },
  ],
};

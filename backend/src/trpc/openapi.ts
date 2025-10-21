import { generateOpenApiDocument } from 'trpc-swagger';
import { appRouter } from './router.js';

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'PKI Manager API',
  version: '1.0.0',
  baseUrl: 'http://localhost:3000/api',
  description: 'Public Key Infrastructure (PKI) Management System API - Certificate Authority and Certificate Management',
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
  docsUrl: 'https://github.com/your-org/pki-manager',
});

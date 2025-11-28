import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, auditLog } from '../../db/schema.js';
import { eq, and, gte, lte, like, or, sql, desc, asc } from 'drizzle-orm';
import { createAuditLog } from '../../lib/audit.js';
import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';

// Request/Response types
interface SearchQuery {
  query: string;
  limit?: number;
}

interface DomainsQuery {
  search?: string;
  caId?: string;
  limit?: number;
  offset?: number;
}

interface ExpiringQuery {
  limit?: number;
}

interface AuditQuery {
  operation?: string;
  entityType?: string;
  entityId?: string;
  status?: 'success' | 'failure';
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
}

interface ReportBody {
  reportType: 'certificate_inventory' | 'revocation' | 'ca_operations';
  format?: 'csv' | 'pdf';
  caId?: string;
  startDate?: number;
  endDate?: number;
}

// Inline error response schemas
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;

// Error response helper
function sendError(
  reply: FastifyReply,
  code: number,
  errorCode: string,
  message: string,
  details?: Array<{ field: string; message: string }>
) {
  reply.code(code);
  return {
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
    },
  };
}

// Helper to extract CN from subject DN
function extractCN(subjectDn: string): string {
  const cnMatch = subjectDn.match(/CN=([^,]+)/);
  return cnMatch ? cnMatch[1].trim() : subjectDn;
}

// Helper to extract SAN from arrays
function formatSAN(sanDns: string[] | null, sanIp: string[] | null, sanEmail: string[] | null): string {
  const sans: string[] = [];
  if (sanDns && sanDns.length > 0) sans.push(...sanDns.map(d => `DNS:${d}`));
  if (sanIp && sanIp.length > 0) sans.push(...sanIp.map(i => `IP:${i}`));
  if (sanEmail && sanEmail.length > 0) sans.push(...sanEmail.map(e => `Email:${e}`));
  return sans.length > 0 ? sans.join(', ') : '-';
}

// Helper to safely parse JSON with fallback
function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// Helper to format certificate type for display
function formatCertificateType(type: 'server' | 'client' | 'code_signing' | 'email'): 'Server' | 'Client' | 'Code Signing' | 'Email (S/MIME)' {
  const typeMap = {
    server: 'Server' as const,
    client: 'Client' as const,
    code_signing: 'Code Signing' as const,
    email: 'Email (S/MIME)' as const,
  };
  return typeMap[type];
}

// Helper to check if domain is wildcard
function isWildcardDomain(domain: string): boolean {
  return domain.startsWith('*.');
}

// Helper to get base domain from wildcard
function getBaseDomain(domain: string): string {
  if (domain.startsWith('*.')) {
    return domain.substring(2);
  }
  return domain;
}

// Helper to extract domains from certificate
function extractDomains(cert: { subjectDn: string; sanDns: string | null }): string[] {
  const domains: Set<string> = new Set();

  // Extract from CN
  const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
  if (cnMatch && cnMatch[1]) {
    const cn = cnMatch[1].trim();
    if (cn.includes('.') || cn.includes('*')) {
      domains.add(cn.toLowerCase());
    }
  }

  // Extract from SAN DNS entries
  if (cert.sanDns) {
    try {
      const sanDnsArray = JSON.parse(cert.sanDns);
      if (Array.isArray(sanDnsArray)) {
        sanDnsArray.forEach((domain: string) => {
          domains.add(domain.toLowerCase());
        });
      }
    } catch {
      // Ignore parse errors
    }
  }

  return Array.from(domains);
}

/**
 * Utility REST routes
 *
 * Endpoints:
 * - GET /search - Global search across CAs, certificates, and domains
 * - GET /domains - List domains with filtering and pagination
 * - GET /dashboard/stats - Dashboard statistics
 * - GET /dashboard/expiring - Expiring items
 * - GET /audit - Audit log entries with filtering
 * - POST /reports - Generate reports
 */
export async function utilityRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /search - Global search
  fastify.get<{ Querystring: SearchQuery }>('/search', {
    schema: {
      description: 'Global search across CAs, certificates, and domains',
      tags: ['Search'],
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            minLength: 1,
            description: 'Search query (minimum 1 character)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            default: 10,
            description: 'Maximum results per category',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            results: {
              type: 'object',
              properties: {
                cas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string', enum: ['ca'] },
                      title: { type: 'string' },
                      subtitle: { type: 'string' },
                      status: { type: 'string' },
                      metadata: { type: 'object' },
                    },
                  },
                },
                certificates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string', enum: ['certificate'] },
                      title: { type: 'string' },
                      subtitle: { type: 'string' },
                      status: { type: 'string' },
                      metadata: { type: 'object' },
                    },
                  },
                },
                domains: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string', enum: ['domain'] },
                      title: { type: 'string' },
                      subtitle: { type: 'string' },
                      status: { type: 'string' },
                      metadata: { type: 'object' },
                    },
                  },
                },
              },
            },
            totalCount: { type: 'integer' },
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { query, limit = 10 } = request.query;

    if (!query || query.length < 1) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Query parameter must be at least 1 character', [
        { field: 'query', message: 'Must be at least 1 character' },
      ]);
    }

    try {
      const searchPattern = `%${query}%`;

      // Search CAs
      const caResults = await db
        .select({
          id: certificateAuthorities.id,
          subjectDn: certificateAuthorities.subjectDn,
          serialNumber: certificateAuthorities.serialNumber,
          status: certificateAuthorities.status,
          notAfter: certificateAuthorities.notAfter,
        })
        .from(certificateAuthorities)
        .where(
          or(
            like(certificateAuthorities.subjectDn, searchPattern),
            like(certificateAuthorities.serialNumber, searchPattern)
          )!
        )
        .limit(limit);

      // Search certificates
      const certResults = await db
        .select({
          id: certificates.id,
          caId: certificates.caId,
          subjectDn: certificates.subjectDn,
          serialNumber: certificates.serialNumber,
          certificateType: certificates.certificateType,
          status: certificates.status,
          notAfter: certificates.notAfter,
          sanDns: certificates.sanDns,
        })
        .from(certificates)
        .where(
          or(
            like(certificates.subjectDn, searchPattern),
            like(certificates.serialNumber, searchPattern),
            like(certificates.sanDns, searchPattern),
            like(certificates.sanEmail, searchPattern)
          )!
        )
        .limit(limit);

      // Extract domains from certificates
      const domainMatches = new Set<string>();
      for (const cert of certResults) {
        const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
        if (cnMatch && cnMatch[1]) {
          const cn = cnMatch[1].trim().toLowerCase();
          if ((cn.includes('.') || cn.includes('*')) && cn.includes(query.toLowerCase())) {
            domainMatches.add(cn);
          }
        }

        if (cert.sanDns) {
          try {
            const sans = JSON.parse(cert.sanDns);
            if (Array.isArray(sans)) {
              sans.forEach((san: string) => {
                if (san.toLowerCase().includes(query.toLowerCase())) {
                  domainMatches.add(san.toLowerCase());
                }
              });
            }
          } catch {}
        }
      }

      // Format results
      const caMatches = caResults.map((ca) => {
        const cn = extractCN(ca.subjectDn);
        return {
          id: ca.id,
          type: 'ca' as const,
          title: cn,
          subtitle: `CA • Serial: ${ca.serialNumber.substring(0, 16)}...`,
          status: ca.status,
          metadata: {
            serialNumber: ca.serialNumber,
            notAfter: ca.notAfter.toISOString(),
          },
        };
      });

      const certificateMatches = certResults.map((cert) => {
        const cn = extractCN(cert.subjectDn);
        return {
          id: cert.id,
          type: 'certificate' as const,
          title: cn,
          subtitle: `${cert.certificateType} Certificate • ${cert.status}`,
          status: cert.status,
          metadata: {
            certificateType: cert.certificateType,
            serialNumber: cert.serialNumber,
            caId: cert.caId,
            notAfter: cert.notAfter.toISOString(),
          },
        };
      });

      const domainMatchesArray = Array.from(domainMatches).slice(0, limit).map((domain) => ({
        id: domain,
        type: 'domain' as const,
        title: domain,
        subtitle: 'Domain',
        status: 'active',
        metadata: {
          domain,
        },
      }));

      logger.info(
        {
          query,
          caCount: caMatches.length,
          certCount: certificateMatches.length,
          domainCount: domainMatchesArray.length,
        },
        'Global search completed'
      );

      return {
        query,
        results: {
          cas: caMatches,
          certificates: certificateMatches,
          domains: domainMatchesArray,
        },
        totalCount: caMatches.length + certificateMatches.length + domainMatchesArray.length,
      };
    } catch (error) {
      logger.error({ error, query }, 'Global search failed');
      return sendError(reply, 500, 'SEARCH_ERROR', 'Search operation failed');
    }
  });

  // GET /domains - List domains
  fastify.get<{ Querystring: DomainsQuery }>('/domains', {
    schema: {
      description: 'List domains with filtering and pagination',
      tags: ['Domains'],
      querystring: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Filter domains by name',
          },
          caId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by issuing CA',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 50,
            description: 'Maximum number of items to return',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Number of items to skip',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  isWildcard: { type: 'boolean' },
                  baseDomain: { type: 'string' },
                  certificateCount: { type: 'integer' },
                  caCount: { type: 'integer' },
                  firstCertificateDate: { type: 'string', format: 'date-time' },
                  lastCertificateDate: { type: 'string', format: 'date-time' },
                  activeCertificateCount: { type: 'integer' },
                  revokedCertificateCount: { type: 'integer' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { search, caId, limit = 50, offset = 0 } = request.query;

    try {
      // Build WHERE conditions
      const conditions: any[] = [];

      if (caId) {
        conditions.push(eq(certificates.caId, caId));
      }

      const whereClause = conditions.length > 0 ? conditions[0] : undefined;

      // Get all certificates (with potential filters)
      const allCerts = await db
        .select({
          id: certificates.id,
          caId: certificates.caId,
          subjectDn: certificates.subjectDn,
          sanDns: certificates.sanDns,
          status: certificates.status,
          notBefore: certificates.notBefore,
          notAfter: certificates.notAfter,
          createdAt: certificates.createdAt,
        })
        .from(certificates)
        .where(whereClause);

      // Extract and aggregate domains
      const domainMap = new Map<
        string,
        {
          domain: string;
          isWildcard: boolean;
          baseDomain: string;
          certificateCount: number;
          caIds: Set<string>;
          firstCertDate: Date;
          lastCertDate: Date;
          activeCertCount: number;
          revokedCertCount: number;
        }
      >();

      for (const cert of allCerts) {
        const domains = extractDomains(cert);

        for (const domain of domains) {
          const existing = domainMap.get(domain);

          if (existing) {
            existing.certificateCount++;
            existing.caIds.add(cert.caId);

            if (cert.createdAt < existing.firstCertDate) {
              existing.firstCertDate = cert.createdAt;
            }
            if (cert.createdAt > existing.lastCertDate) {
              existing.lastCertDate = cert.createdAt;
            }

            if (cert.status === 'active') {
              existing.activeCertCount++;
            } else if (cert.status === 'revoked') {
              existing.revokedCertCount++;
            }
          } else {
            domainMap.set(domain, {
              domain,
              isWildcard: isWildcardDomain(domain),
              baseDomain: getBaseDomain(domain),
              certificateCount: 1,
              caIds: new Set([cert.caId]),
              firstCertDate: cert.createdAt,
              lastCertDate: cert.createdAt,
              activeCertCount: cert.status === 'active' ? 1 : 0,
              revokedCertCount: cert.status === 'revoked' ? 1 : 0,
            });
          }
        }
      }

      // Convert to array and apply search filter
      let domainsList = Array.from(domainMap.values());

      if (search) {
        const searchLower = search.toLowerCase();
        domainsList = domainsList.filter((d) => d.domain.includes(searchLower));
      }

      // Sort by certificate count (descending)
      domainsList.sort((a, b) => b.certificateCount - a.certificateCount);

      // Get total count before pagination
      const totalCount = domainsList.length;

      // Apply pagination
      const paginatedDomains = domainsList.slice(offset, offset + limit);

      // Format response
      const formattedDomains = paginatedDomains.map((d) => ({
        domain: d.domain,
        isWildcard: d.isWildcard,
        baseDomain: d.baseDomain,
        certificateCount: d.certificateCount,
        caCount: d.caIds.size,
        firstCertificateDate: d.firstCertDate.toISOString(),
        lastCertificateDate: d.lastCertDate.toISOString(),
        activeCertificateCount: d.activeCertCount,
        revokedCertificateCount: d.revokedCertCount,
      }));

      logger.info(
        {
          totalDomains: totalCount,
          returnedDomains: formattedDomains.length,
          search,
          caId,
        },
        'Domain list retrieved'
      );

      return {
        items: formattedDomains,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + formattedDomains.length < totalCount,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Domain list failed');
      return sendError(reply, 500, 'DOMAIN_LIST_ERROR', 'Failed to list domains');
    }
  });

  // GET /dashboard/stats - Dashboard statistics
  fastify.get('/dashboard/stats', {
    schema: {
      description: 'Get dashboard statistics (CA and certificate counts)',
      tags: ['Dashboard'],
      response: {
        200: {
          type: 'object',
          properties: {
            totalCAs: { type: 'integer' },
            activeCAs: { type: 'integer' },
            totalCertificates: { type: 'integer' },
            activeCertificates: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (_request, reply) => {
    try {
      const now = new Date();

      // Get CA counts
      const [caTotal] = await db
        .select({ count: sql<number>`count(*)` })
        .from(certificateAuthorities);

      const [caActive] = await db
        .select({ count: sql<number>`count(*)` })
        .from(certificateAuthorities)
        .where(
          and(
            eq(certificateAuthorities.status, 'active'),
            gte(certificateAuthorities.notAfter, now)
          )
        );

      // Get certificate counts
      const [certTotal] = await db
        .select({ count: sql<number>`count(*)` })
        .from(certificates);

      const [certActive] = await db
        .select({ count: sql<number>`count(*)` })
        .from(certificates)
        .where(
          and(
            eq(certificates.status, 'active'),
            gte(certificates.notAfter, now)
          )
        );

      return {
        totalCAs: Number(caTotal.count || 0),
        activeCAs: Number(caActive.count || 0),
        totalCertificates: Number(certTotal.count || 0),
        activeCertificates: Number(certActive.count || 0),
      };
    } catch (error) {
      logger.error({ error }, 'Dashboard stats failed');
      return sendError(reply, 500, 'STATS_ERROR', 'Failed to get dashboard statistics');
    }
  });

  // GET /dashboard/expiring - Expiring items
  fastify.get<{ Querystring: ExpiringQuery }>('/dashboard/expiring', {
    schema: {
      description: 'Get items (CAs and certificates) expiring soonest',
      tags: ['Dashboard'],
      querystring: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            default: 5,
            description: 'Maximum number of items to return',
          },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              cn: { type: 'string' },
              san: { type: 'string' },
              notAfter: { type: 'string', format: 'date-time' },
              daysRemaining: { type: 'integer' },
            },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { limit = 5 } = request.query;

    try {
      const now = new Date();

      // Get CAs expiring soon (not expired, not revoked)
      const expiringCAs = await db
        .select()
        .from(certificateAuthorities)
        .where(
          and(
            eq(certificateAuthorities.status, 'active'),
            gte(certificateAuthorities.notAfter, now)
          )
        )
        .orderBy(asc(certificateAuthorities.notAfter))
        .limit(limit);

      // Get certificates expiring soon (not expired, not revoked)
      const expiringCerts = await db
        .select()
        .from(certificates)
        .where(
          and(
            eq(certificates.status, 'active'),
            gte(certificates.notAfter, now)
          )
        )
        .orderBy(asc(certificates.notAfter))
        .limit(limit);

      // Combine and sort by expiry date
      const combined = [
        ...expiringCAs.map(ca => ({
          id: ca.id,
          type: 'CA' as const,
          cn: extractCN(ca.subjectDn),
          san: '-',
          notAfter: ca.notAfter,
          sortKey: ca.notAfter.getTime(),
        })),
        ...expiringCerts.map(cert => ({
          id: cert.id,
          type: formatCertificateType(cert.certificateType),
          cn: extractCN(cert.subjectDn),
          san: formatSAN(
            safeJsonParse<string[]>(cert.sanDns),
            safeJsonParse<string[]>(cert.sanIp),
            safeJsonParse<string[]>(cert.sanEmail)
          ),
          notAfter: cert.notAfter,
          sortKey: cert.notAfter.getTime(),
        })),
      ];

      // Sort by expiry date and take top N
      combined.sort((a, b) => a.sortKey - b.sortKey);
      const topExpiring = combined.slice(0, limit);

      // Calculate days remaining
      return topExpiring.map(item => {
        const daysRemaining = Math.ceil((item.notAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: item.id,
          type: item.type,
          cn: item.cn,
          san: item.san,
          notAfter: item.notAfter.toISOString(),
          daysRemaining,
        };
      });
    } catch (error) {
      logger.error({ error }, 'Expiring items query failed');
      return sendError(reply, 500, 'EXPIRING_ERROR', 'Failed to get expiring items');
    }
  });

  // GET /audit - Audit log entries
  fastify.get<{ Querystring: AuditQuery }>('/audit', {
    schema: {
      description: 'Get audit log entries with filtering',
      tags: ['Audit'],
      querystring: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Filter by operation (e.g., ca.create, certificate.issue)',
          },
          entityType: {
            type: 'string',
            description: 'Filter by entity type (ca, certificate, audit, report)',
          },
          entityId: {
            type: 'string',
            description: 'Filter by specific entity ID',
          },
          status: {
            type: 'string',
            enum: ['success', 'failure'],
            description: 'Filter by status',
          },
          startDate: {
            type: 'integer',
            description: 'Filter by start date (Unix timestamp)',
          },
          endDate: {
            type: 'integer',
            description: 'Filter by end date (Unix timestamp)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 100,
            description: 'Maximum number of items to return',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Number of items to skip',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  operation: { type: 'string' },
                  entityType: { type: 'string' },
                  entityId: { type: 'string', nullable: true },
                  ipAddress: { type: 'string', nullable: true },
                  status: { type: 'string', enum: ['success', 'failure'] },
                  details: { type: 'object', nullable: true },
                },
              },
            },
            totalCount: { type: 'integer' },
            pagination: {
              type: 'object',
              properties: {
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { operation, entityType, entityId, status, startDate, endDate, limit = 100, offset = 0 } = request.query;

    try {
      // Build WHERE conditions
      const conditions: any[] = [];

      if (operation) {
        conditions.push(eq(auditLog.operation, operation));
      }

      if (entityType) {
        conditions.push(eq(auditLog.entityType, entityType));
      }

      if (entityId) {
        conditions.push(eq(auditLog.entityId, entityId));
      }

      if (status) {
        conditions.push(eq(auditLog.status, status));
      }

      if (startDate) {
        conditions.push(gte(auditLog.timestamp, new Date(startDate * 1000)));
      }

      if (endDate) {
        conditions.push(lte(auditLog.timestamp, new Date(endDate * 1000)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(whereClause);
      const totalCount = Number(countResult[0]?.count || 0);

      // Query audit logs with pagination (most recent first)
      const logs = await db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.timestamp))
        .limit(limit)
        .offset(offset);

      // Parse details JSON for each log entry
      const formattedLogs = logs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        operation: log.operation,
        entityType: log.entityType,
        entityId: log.entityId,
        ipAddress: log.ipAddress,
        status: log.status,
        details: log.details ? JSON.parse(log.details) : null,
      }));

      // Create audit log entry for this query (non-blocking)
      createAuditLog({
        db,
        operation: 'audit.list',
        entityType: 'audit',
        status: 'success',
        details: {
          filters: { operation, entityType, entityId, status, startDate, endDate },
          resultCount: formattedLogs.length,
        },
        ipAddress: request.ip,
      }).catch(() => {
        // Ignore audit log errors to prevent recursion
      });

      return {
        items: formattedLogs,
        totalCount,
        pagination: {
          limit,
          offset,
          hasMore: offset + formattedLogs.length < totalCount,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Audit log query failed');
      return sendError(reply, 500, 'AUDIT_ERROR', 'Failed to query audit logs');
    }
  });

  // POST /reports - Generate reports
  fastify.post<{ Body: ReportBody }>('/reports', {
    schema: {
      description: 'Generate reports (certificate inventory, revocation, CA operations)',
      tags: ['Audit'],
      body: {
        type: 'object',
        required: ['reportType'],
        properties: {
          reportType: {
            type: 'string',
            enum: ['certificate_inventory', 'revocation', 'ca_operations'],
            description: 'Type of report to generate',
          },
          format: {
            type: 'string',
            enum: ['csv', 'pdf'],
            default: 'csv',
            description: 'Report format (pdf returns 501)',
          },
          caId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by CA ID',
          },
          startDate: {
            type: 'integer',
            description: 'Filter by start date (Unix timestamp)',
          },
          endDate: {
            type: 'integer',
            description: 'Filter by end date (Unix timestamp)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reportName: { type: 'string' },
            format: { type: 'string' },
            content: { type: 'string' },
            summary: { type: 'object' },
            generatedAt: { type: 'string', format: 'date-time' },
            hash: { type: 'string' },
            recordCount: { type: 'integer' },
          },
        },
        400: errorResponseSchema,
        501: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { reportType, format = 'csv', caId, startDate, endDate } = request.body;

    // Check for PDF format - not yet implemented
    if (format === 'pdf') {
      reply.code(501);
      return {
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'PDF format not yet implemented. Use CSV format.',
        },
      };
    }

    try {
      // Build date filter conditions
      const dateConditions: any[] = [];
      if (startDate) {
        dateConditions.push(gte(certificates.createdAt, new Date(startDate * 1000)));
      }
      if (endDate) {
        dateConditions.push(lte(certificates.createdAt, new Date(endDate * 1000)));
      }

      let data: any[] = [];
      let reportName = '';
      let summary: Record<string, any> = {};

      // Generate report based on type
      if (reportType === 'certificate_inventory') {
        reportName = 'Certificate Inventory Report';

        // Build where conditions
        const conditions: any[] = [...dateConditions];
        if (caId) {
          conditions.push(eq(certificates.caId, caId));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Query certificates
        const certs = await db
          .select()
          .from(certificates)
          .where(whereClause)
          .orderBy(desc(certificates.createdAt));

        data = certs.map((cert) => ({
          id: cert.id,
          caId: cert.caId,
          serialNumber: cert.serialNumber,
          subjectDn: cert.subjectDn,
          certificateType: cert.certificateType,
          status: cert.status,
          notBefore: cert.notBefore.toISOString(),
          notAfter: cert.notAfter.toISOString(),
          createdAt: cert.createdAt.toISOString(),
        }));

        // Calculate summary
        summary = {
          totalCertificates: data.length,
          activeCertificates: data.filter((c) => c.status === 'active').length,
          revokedCertificates: data.filter((c) => c.status === 'revoked').length,
          expiredCertificates: data.filter((c) => c.status === 'expired').length,
        };
      } else if (reportType === 'revocation') {
        reportName = 'Revocation Report';

        // Build where conditions
        const conditions: any[] = [...dateConditions, eq(certificates.status, 'revoked')];
        if (caId) {
          conditions.push(eq(certificates.caId, caId));
        }
        const whereClause = and(...conditions);

        // Query revoked certificates
        const certs = await db
          .select()
          .from(certificates)
          .where(whereClause)
          .orderBy(desc(certificates.revocationDate));

        data = certs.map((cert) => ({
          id: cert.id,
          caId: cert.caId,
          serialNumber: cert.serialNumber,
          subjectDn: cert.subjectDn,
          revocationDate: cert.revocationDate?.toISOString() || 'N/A',
          revocationReason: cert.revocationReason || 'N/A',
          createdAt: cert.createdAt.toISOString(),
        }));

        // Calculate summary
        summary = {
          totalRevocations: data.length,
        };
      } else if (reportType === 'ca_operations') {
        reportName = 'CA Operations Report';

        // Build date conditions for audit log
        const auditDateConditions: any[] = [];
        if (startDate) {
          auditDateConditions.push(gte(auditLog.timestamp, new Date(startDate * 1000)));
        }
        if (endDate) {
          auditDateConditions.push(lte(auditLog.timestamp, new Date(endDate * 1000)));
        }

        // Build where conditions
        const conditions: any[] = [
          ...auditDateConditions,
          eq(auditLog.entityType, 'ca'),
        ];
        const whereClause = and(...conditions);

        // Query CA operations from audit log
        const logs = await db
          .select()
          .from(auditLog)
          .where(whereClause)
          .orderBy(desc(auditLog.timestamp));

        data = logs.map((log) => ({
          id: log.id,
          timestamp: log.timestamp.toISOString(),
          operation: log.operation,
          entityId: log.entityId,
          status: log.status,
          ipAddress: log.ipAddress || 'N/A',
        }));

        // Calculate summary
        summary = {
          totalOperations: data.length,
          successfulOperations: data.filter((o) => o.status === 'success').length,
          failedOperations: data.filter((o) => o.status === 'failure').length,
        };
      }

      // Generate CSV content
      const header = Object.keys(data[0] || {}).join(',');
      const rows = data.map((row) => Object.values(row).join(','));
      const csvContent = [header, ...rows].join('\n');

      // Generate report metadata
      const generatedAt = new Date().toISOString();
      const reportHash = createHash('sha256').update(csvContent).digest('hex');

      // Create CSV with header
      const csvHeader = [
        `# ${reportName}`,
        `# Generated: ${generatedAt}`,
        `# Filters: CA=${caId || 'All'}, Start=${startDate || 'N/A'}, End=${endDate || 'N/A'}`,
        `# Summary: ${JSON.stringify(summary)}`,
        `# Hash: ${reportHash}`,
        '',
      ].join('\n');

      const fullCsv = csvHeader + csvContent;

      // Log report generation
      await createAuditLog({
        db,
        operation: 'audit.generateReport',
        entityType: 'report',
        status: 'success',
        details: {
          reportType,
          format,
          recordCount: data.length,
          summary,
        },
        ipAddress: request.ip,
      });

      return {
        reportName,
        format,
        content: fullCsv,
        summary,
        generatedAt,
        hash: reportHash,
        recordCount: data.length,
      };
    } catch (error) {
      logger.error({ error, reportType }, 'Report generation failed');
      return sendError(reply, 500, 'REPORT_ERROR', 'Failed to generate report');
    }
  });
}

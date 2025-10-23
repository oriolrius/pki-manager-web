import { router, publicProcedure } from '../init.js';
import { z } from 'zod';
import { certificates, certificateAuthorities } from '../../db/schema.js';
import { eq, like, sql, desc } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

const listDomainsSchema = z
  .object({
    search: z.string().optional(),
    caId: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .optional();

/**
 * Extract domain names from certificate subject DN and SANs
 */
function extractDomains(cert: any): string[] {
  const domains: Set<string> = new Set();

  // Extract from CN (Common Name)
  const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
  if (cnMatch && cnMatch[1]) {
    const cn = cnMatch[1].trim();
    // Check if CN looks like a domain (not an email or username)
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
    } catch (error) {
      logger.warn({ error, certId: cert.id }, 'Failed to parse SAN DNS');
    }
  }

  return Array.from(domains);
}

/**
 * Check if a domain is a wildcard domain
 */
function isWildcardDomain(domain: string): boolean {
  return domain.startsWith('*.');
}

/**
 * Get the base domain from a wildcard or subdomain
 */
function getBaseDomain(domain: string): string {
  if (domain.startsWith('*.')) {
    return domain.substring(2);
  }
  // Return the domain as-is (could be enhanced to extract base domain from subdomains)
  return domain;
}

export const domainRouter = router({
  list: publicProcedure
    .input(listDomainsSchema)
    .query(async ({ ctx, input }) => {
      const params = input || {
        limit: 50,
        offset: 0,
      };

      // Build WHERE conditions
      const conditions: any[] = [];

      if (params.caId) {
        conditions.push(eq(certificates.caId, params.caId));
      }

      // For search, we'll filter domains after extraction
      // since domains are stored in CN and SAN fields

      // Get all certificates (with potential filters)
      const whereClause = conditions.length > 0 ? conditions[0] : undefined;

      const allCerts = await ctx.db
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

      if (params.search) {
        const searchLower = params.search.toLowerCase();
        domainsList = domainsList.filter((d) => d.domain.includes(searchLower));
      }

      // Sort by certificate count (descending)
      domainsList.sort((a, b) => b.certificateCount - a.certificateCount);

      // Get total count before pagination
      const totalCount = domainsList.length;

      // Apply pagination
      const paginatedDomains = domainsList.slice(
        params.offset,
        params.offset + params.limit
      );

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
          search: params.search,
          caId: params.caId,
        },
        'Domain list retrieved'
      );

      return {
        items: formattedDomains,
        totalCount,
        limit: params.limit,
        offset: params.offset,
      };
    }),
});

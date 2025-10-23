import { router, publicProcedure } from '../init.js';
import { z } from 'zod';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { like, or, sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

const globalSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

export const searchRouter = router({
  global: publicProcedure
    .input(globalSearchSchema)
    .query(async ({ ctx, input }) => {
      const { query, limit } = input;
      const searchPattern = `%${query}%`;

      try {
        // Search CAs (by CN, organization in subject DN)
        const caResults = await ctx.db
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

        // Search certificates (by CN, subject, SAN, serial, fingerprint concepts)
        const certResults = await ctx.db
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
          // Extract CN
          const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
          if (cnMatch && cnMatch[1]) {
            const cn = cnMatch[1].trim().toLowerCase();
            if ((cn.includes('.') || cn.includes('*')) && cn.includes(query.toLowerCase())) {
              domainMatches.add(cn);
            }
          }

          // Extract from SANs
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
          const cnMatch = ca.subjectDn.match(/CN=([^,]+)/);
          const cn = cnMatch ? cnMatch[1].trim() : ca.subjectDn;

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
          const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
          const cn = cnMatch ? cnMatch[1].trim() : cert.subjectDn;

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
          totalCount:
            caMatches.length + certificateMatches.length + domainMatchesArray.length,
        };
      } catch (error) {
        logger.error({ error, query }, 'Global search failed');
        throw error;
      }
    }),
});

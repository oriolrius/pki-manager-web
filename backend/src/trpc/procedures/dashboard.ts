import { z } from 'zod';
import { router, publicProcedure } from '../init.js';
import { eq, sql, asc, gte, and } from 'drizzle-orm';
import { certificateAuthorities, certificates } from '../../db/schema.js';

// Helper to extract CN from subject DN
function extractCN(subjectDn: string): string {
  const cnMatch = subjectDn.match(/CN=([^,]+)/);
  return cnMatch ? cnMatch[1] : subjectDn;
}

// Helper to extract SAN from arrays
function formatSAN(sanDns: string[] | null, sanIp: string[] | null, sanEmail: string[] | null): string {
  const sans: string[] = [];
  if (sanDns && sanDns.length > 0) sans.push(...sanDns.map(d => `DNS:${d}`));
  if (sanIp && sanIp.length > 0) sans.push(...sanIp.map(i => `IP:${i}`));
  if (sanEmail && sanEmail.length > 0) sans.push(...sanEmail.map(e => `Email:${e}`));
  return sans.length > 0 ? sans.join(', ') : '-';
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

export const dashboardRouter = router({
  stats: publicProcedure
    .output(
      z.object({
        totalCAs: z.number(),
        activeCAs: z.number(),
        totalCertificates: z.number(),
        activeCertificates: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      const now = new Date();

      // Get CA counts
      const [caTotal] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(certificateAuthorities);

      const [caActive] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(certificateAuthorities)
        .where(
          and(
            eq(certificateAuthorities.status, 'active'),
            gte(certificateAuthorities.notAfter, now)
          )
        );

      // Get certificate counts
      const [certTotal] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(certificates);

      const [certActive] = await ctx.db
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
    }),

  expiringSoon: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(20).default(5),
      }).optional()
    )
    .output(
      z.array(
        z.object({
          id: z.string(),
          type: z.enum(['CA', 'Server', 'Client', 'Code Signing', 'Email (S/MIME)']),
          cn: z.string(),
          san: z.string(),
          notAfter: z.string(),
          daysRemaining: z.number(),
        })
      )
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit || 5;
      const now = new Date();

      // Get CAs expiring soon (not expired, not revoked)
      const expiringCAs = await ctx.db
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
      const expiringCerts = await ctx.db
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
            cert.sanDns ? JSON.parse(cert.sanDns) : null,
            cert.sanIp ? JSON.parse(cert.sanIp) : null,
            cert.sanEmail ? JSON.parse(cert.sanEmail) : null
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
    }),
});

import { router, publicProcedure } from '../init.js';
import { listAuditLogSchema, generateReportSchema } from '../schemas.js';
import { auditLog, certificates, certificateAuthorities } from '../../db/schema.js';
import { eq, and, gte, lte, like, sql, desc } from 'drizzle-orm';
import { createAuditLog } from '../../lib/audit.js';
import { createHash } from 'crypto';

export const auditRouter = router({
  list: publicProcedure
    .input(listAuditLogSchema)
    .query(async ({ ctx, input }) => {
      const params = input || {
        limit: 100,
        offset: 0,
      };

      // Build WHERE conditions
      const conditions: any[] = [];

      // Filter by operation
      if (params.operation) {
        conditions.push(eq(auditLog.operation, params.operation));
      }

      // Filter by entity type
      if (params.entityType) {
        conditions.push(eq(auditLog.entityType, params.entityType));
      }

      // Filter by entity ID
      if (params.entityId) {
        conditions.push(eq(auditLog.entityId, params.entityId));
      }

      // Filter by status
      if (params.status) {
        conditions.push(eq(auditLog.status, params.status));
      }

      // Filter by date range
      if (params.startDate) {
        conditions.push(gte(auditLog.timestamp, new Date(params.startDate * 1000)));
      }

      if (params.endDate) {
        conditions.push(lte(auditLog.timestamp, new Date(params.endDate * 1000)));
      }

      // Build the WHERE clause
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const countResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(whereClause);
      const totalCount = Number(countResult[0]?.count || 0);

      // Query audit logs with pagination (most recent first)
      const logs = await ctx.db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.timestamp))
        .limit(params.limit)
        .offset(params.offset);

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
        kmsOperationId: log.kmsOperationId,
      }));

      // Create audit log entry for this query (non-blocking)
      createAuditLog({
        db: ctx.db,
        operation: 'audit.list',
        entityType: 'audit',
        status: 'success',
        details: {
          filters: {
            operation: params.operation,
            entityType: params.entityType,
            entityId: params.entityId,
            status: params.status,
            startDate: params.startDate,
            endDate: params.endDate,
          },
          resultCount: formattedLogs.length,
        },
        ipAddress: ctx.req.ip,
      }).catch((err) => {
        // Ignore audit log errors to prevent recursion
      });

      return {
        items: formattedLogs,
        totalCount,
        limit: params.limit,
        offset: params.offset,
      };
    }),

  generateReport: publicProcedure
    .input(generateReportSchema)
    .mutation(async ({ ctx, input }) => {
      const { reportType, format, caId, startDate, endDate } = input;

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
        const certs = await ctx.db
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
        const certs = await ctx.db
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
        const logs = await ctx.db
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

      // Generate report content based on format
      if (format === 'csv') {
        // Generate CSV
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
          db: ctx.db,
          operation: 'audit.generateReport',
          entityType: 'report',
          status: 'success',
          details: {
            reportType,
            format,
            recordCount: data.length,
            summary,
          },
          ipAddress: ctx.req.ip,
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
      } else {
        // PDF format not yet implemented
        throw new Error('PDF format not yet implemented. Use CSV format.');
      }
    }),
});

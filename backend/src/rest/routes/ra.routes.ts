import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';
import { RAError, RAService } from '../../services/ra.service.js';

// Registered inside externalRoutes: inherits integration auth and rejection audit.
export async function raRoutes(app: FastifyInstance) {
  const service = new RAService();
  app.addHook('preValidation', async (req, reply) => {
    const allowed = req.url.split('?')[0].endsWith('/sign') ? ['digest'] : req.url.split('?')[0].endsWith('/decrypt') ? ['data'] : [];
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).some(key => !allowed.includes(key))) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'RA key identifiers and operation overrides are not accepted' } });
    }
  });
  const emptyBody = { type: 'object', properties: {}, additionalProperties: false };
  for (const op of ['state', 'provision', 'renew', 'sign', 'decrypt'] as const) {
    app.route<{ Body: { digest?: string; data?: string } }>({
      method: op === 'state' ? 'GET' : 'POST', url: `/ra/${op}`,
      schema: {
        tags: ['External Issuer'], security: [{ integrationToken: [] }],
        summary: `Backend-owned SCEP RA ${op}; identifiers resolved from integration`,
        ...(op === 'state' ? {} : { body: op === 'sign' || op === 'decrypt' ? {
          type: 'object', additionalProperties: false,
          required: [op === 'sign' ? 'digest' : 'data'],
          properties: { [op === 'sign' ? 'digest' : 'data']: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9+/]+={0,2}$' } },
        } : emptyBody }),
      },
      handler: async (req, reply) => {
        const identity = req.integration!;
        // Persist intent before any KMS work. If audit storage fails, no operation
        // is performed. Completing this row never records digests/plaintext/tokens.
        const id = randomUUID();
        await db.insert(auditLog).values({ id, operation: `scep.ra.${op}`, entityType: 'integration', entityId: identity.id,
          status: 'failure', ipAddress: req.ip, details: JSON.stringify({ phase: 'started' }),
        });
        try {
          let result;
          if (op === 'state') result = await service.state(identity);
          else if (op === 'provision') result = await service.provision(identity);
          else if (op === 'renew') result = await service.renew(identity);
          else {
            const input = Buffer.from((op === 'sign' ? req.body.digest : req.body.data)!, 'base64');
            const output = op === 'sign' ? await service.sign(identity, input) : await service.decrypt(identity, input);
            result = { data: output.toString('base64') };
          }
          await db.update(auditLog).set({ status: 'success', details: JSON.stringify({ phase: 'completed' }) }).where(eq(auditLog.id, id));
          return result;
        } catch (error) {
          const code = error instanceof RAError ? error.statusCode : 502;
          await db.update(auditLog).set({ details: JSON.stringify({ phase: 'failed', statusCode: code }) }).where(eq(auditLog.id, id));
          return reply.code(code).send({ error: { code: 'RA_OPERATION_FAILED', message: error instanceof RAError ? error.message : 'RA KMS operation failed' } });
        }
      },
    });
  }
}

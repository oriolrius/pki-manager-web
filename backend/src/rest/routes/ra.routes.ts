import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';
import { RAError, RAService, SESSION_KEY_LENGTHS, isSessionKeyLength, type RAOperationContext } from '../../services/ra.service.js';

const base64 = { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9+/]+={0,2}$' } as const;
const bodies = {
  sign: { type: 'object', additionalProperties: false, required: ['digest'], properties: { digest: base64 } },
  decrypt: {
    type: 'object', additionalProperties: false, required: ['data'],
    properties: {
      data: base64,
      sessionKeyLength: {
        type: 'integer', enum: [...SESSION_KEY_LENGTHS],
        description: 'CMS session key length in bytes of the envelope content cipher (16: AES-128, 24: 3DES, 32: AES-256). '
          + 'When given, the unwrapped key must have exactly this length. OpenBao bindings require this field. Legacy Cosmian bindings accept 16, 24 or 32 bytes when it is omitted. '
          + 'A JSON integer only: a string such as "16" is rejected.',
      },
    },
  },
} as const;

// Registered inside externalRoutes: inherits integration auth and rejection audit.
export async function raRoutes(app: FastifyInstance) {
  const service = new RAService();
  app.addHook('preValidation', async (req, reply) => {
    const path = req.url.split('?')[0];
    const allowed = path.endsWith('/sign') ? ['digest'] : path.endsWith('/decrypt') ? ['data', 'sessionKeyLength'] : [];
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).some(key => !allowed.includes(key))) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'RA key identifiers and operation overrides are not accepted' } });
    }
    // Check the type before schema validation: Fastify's ajv coerces "16" to 16.
    if (path.endsWith('/decrypt') && req.body && typeof req.body === 'object' && 'sessionKeyLength' in req.body
      && !isSessionKeyLength((req.body as { sessionKeyLength: unknown }).sessionKeyLength)) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'sessionKeyLength must be the JSON integer 16, 24 or 32' } });
    }
  });
  const emptyBody = { type: 'object', properties: {}, additionalProperties: false };
  for (const op of ['state', 'provision', 'renew', 'sign', 'decrypt'] as const) {
    app.route<{ Body: { digest?: string; data?: string; sessionKeyLength?: number } }>({
      method: op === 'state' ? 'GET' : 'POST', url: `/ra/${op}`,
      schema: {
        tags: ['External Issuer'], security: [{ integrationToken: [] }],
        summary: `Backend-owned SCEP RA ${op}; identifiers resolved from integration`,
        ...(op === 'state' ? {} : { body: op === 'sign' || op === 'decrypt' ? bodies[op] : emptyBody }),
      },
      handler: async (req, reply) => {
        const identity = req.integration!;
        // Persist intent before any KMS work. If audit storage fails, no operation
        // is performed. Completing this row never records digests/plaintext/tokens.
        const id = randomUUID();
        await db.insert(auditLog).values({ id, operation: `scep.ra.${op}`, entityType: 'integration', entityId: identity.id,
          status: 'failure', ipAddress: req.ip, details: JSON.stringify({ phase: 'started' }),
        });
        req.externalAudited = true;
        // The service records the key provider of the binding (cosmian/openbao) for the audit row.
        const context: RAOperationContext = {};
        try {
          let result;
          if (op === 'state') result = await service.state(identity, context);
          else if (op === 'provision') result = await service.provision(identity, context);
          else if (op === 'renew') result = await service.renew(identity, context);
          else if (op === 'sign') result = { data: (await service.sign(identity, Buffer.from(req.body.digest!, 'base64'), context)).toString('base64') };
          else result = { data: (await service.decrypt(identity, Buffer.from(req.body.data!, 'base64'), req.body.sessionKeyLength, context)).toString('base64') };
          await db.update(auditLog).set({ status: 'success', details: JSON.stringify({ phase: 'completed', ...(context.provider ? { provider: context.provider } : {}) }) }).where(eq(auditLog.id, id));
          return result;
        } catch (error) {
          const code = error instanceof RAError ? error.statusCode : 502;
          await db.update(auditLog).set({ details: JSON.stringify({ phase: 'failed', statusCode: code, code: 'RA_OPERATION_FAILED', ...(context.provider ? { provider: context.provider } : {}) }) }).where(eq(auditLog.id, id));
          return reply.code(code).send({ error: { code: 'RA_OPERATION_FAILED', message: error instanceof RAError ? error.message : 'RA KMS operation failed' } });
        }
      },
    });
  }
}

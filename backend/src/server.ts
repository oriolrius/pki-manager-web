import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { registerRestApi } from './rest/index.js';
import { registerSshPublicRoutes } from './rest/routes/ssh-public.routes.js';
import { registerSshExternalRoutes } from './rest/routes/ssh-external.routes.js';
import { externalRoutes } from './rest/routes/external.routes.js';
import { publicCrlRoutes } from './rest/routes/public-crl.routes.js';
import { db } from './db/client.js';
import { certificateAuthorities } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { initializeOIDC } from './lib/oidc.js';

const server = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Register CORS - Allow multiple origins
await server.register(cors, {
  origin: true, // Allow all origins in development
  credentials: true,
});

// Register REST API with OpenAPI/Swagger documentation
await registerRestApi(server);

// Register external issuer API (cluster bearer-token auth, separate from OIDC)
await server.register(externalRoutes, { prefix: '/api/v1/external' });

// Register tRPC at the ROOT /trpc prefix. The @trpc/server fastify adapter
// registers a bare `fastify.all('/trpc/:path')` with no schema, so @fastify/swagger
// would otherwise advertise `/trpc/{path}` in the /api/v1 OpenAPI doc — a URL that
// is unreachable under the /api/v1 server base (a client would request
// /api/v1/trpc/… → 404). Wrap the registration in an encapsulated context whose
// `onRoute` hook marks every tRPC route `hide: true`; this affects ONLY the
// OpenAPI document, not routing/validation, so tRPC keeps working exactly as
// before (TASK-208).
await server.register(async (trpcScope) => {
  trpcScope.addHook('onRoute', (routeOptions) => {
    routeOptions.schema = { ...routeOptions.schema, hide: true };
  });
  await trpcScope.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
    },
  });
});

// Health check endpoint (legacy - kept for backward compatibility). Hidden from
// the /api/v1 OpenAPI doc: it is mounted at the ROOT (a client resolving it
// against the /api/v1 server base would 404), and /api/v1/health already covers
// it in the spec (TASK-208).
server.get('/health', { schema: { hide: true } }, async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Public CA certificate endpoint - serves CA certificates for download.
// hide:true keeps this ROOT route out of the /api/v1 OpenAPI doc (it is
// unreachable under the /api/v1 server base); routing is unaffected (TASK-208).
server.get('/cas/:caId.:format', { schema: { hide: true } }, async (req, reply) => {
  const { caId, format } = req.params as { caId: string; format: string };

  // Validate format
  const validFormats = ['pem', 'crt', 'cer', 'der'];
  if (!validFormats.includes(format)) {
    reply.code(400);
    return { error: `Invalid format. Supported formats: ${validFormats.join(', ')}` };
  }

  try {
    // Check if CA exists
    const ca = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      reply.code(404);
      return { error: `CA with ID ${caId} not found` };
    }

    const caRecord = ca[0];

    // Get certificate from KMS
    const { getKMSService } = await import('./kms/service.js');
    const kmsService = getKMSService();
    const certificatePem = await kmsService.getCertificate(
      caRecord.kmsCertificateId,
      caRecord.id
    );

    // Convert to appropriate format
    let content: Buffer;
    let contentType: string;
    let filename: string;

    // Extract CN for filename
    const cnMatch = caRecord.subjectDn.match(/CN=([^,]+)/);
    const cn = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'ca-certificate';

    if (format === 'pem' || format === 'crt') {
      // PEM format (ASCII)
      content = Buffer.from(certificatePem, 'utf8');
      contentType = 'application/x-pem-file';
      filename = `${cn}.${format}`;
    } else if (format === 'der' || format === 'cer') {
      // DER format (binary) - convert PEM to DER
      const base64Data = certificatePem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\n/g, '')
        .trim();
      content = Buffer.from(base64Data, 'base64');
      contentType = 'application/x-x509-ca-cert';
      filename = `${cn}.${format}`;
    } else {
      reply.code(400);
      return { error: 'Invalid format' };
    }

    // Set headers for download
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', content.length);

    // Add caching headers
    reply.header('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    return content;
  } catch (error) {
    server.log.error({ error, caId }, 'Failed to serve CA certificate');
    reply.code(500);
    return { error: 'Internal server error while serving CA certificate' };
  }
});

// Public CRL endpoint - serves Certificate Revocation Lists (extracted plugin, also tested directly)
await server.register(publicCrlRoutes);

// Public SSH trust-material download endpoints (no auth, like /crl).
registerSshPublicRoutes(server);

// SSH external/automation signing API (fleet-token auth, bypasses OIDC).
registerSshExternalRoutes(server);

// Start server
const start = async () => {
  try {
    // Initialize OIDC configuration (validates env vars and fetches JWKS if enabled)
    await initializeOIDC();

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);
    console.log(`Swagger UI available at http://${host}:${port}/api/docs`);
    console.log(`OpenAPI JSON available at http://${host}:${port}/api/v1/openapi.json`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

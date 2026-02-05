import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { registerRestApi } from './rest/index.js';
import { db } from './db/client.js';
import { certificateAuthorities, crls } from './db/schema.js';
import { eq, desc } from 'drizzle-orm';
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

// Register tRPC
await server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
});

// Health check endpoint (legacy - kept for backward compatibility)
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Public CA certificate endpoint - serves CA certificates for download
server.get('/cas/:caId.:format', async (req, reply) => {
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

// Public CRL endpoint - serves Certificate Revocation Lists
server.get('/crl/:caId.:format', async (req, reply) => {
  const { caId, format } = req.params as { caId: string; format: string };

  // Validate format
  if (format !== 'crl' && format !== 'der') {
    reply.code(400);
    return { error: 'Invalid format. Use .crl for PEM or .der for DER format' };
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

    // Get latest CRL for this CA
    const latestCrl = await db
      .select()
      .from(crls)
      .where(eq(crls.caId, caId))
      .orderBy(desc(crls.crlNumber))
      .limit(1);

    if (!latestCrl || latestCrl.length === 0) {
      reply.code(404);
      return { error: `No CRL available for CA ${caId}` };
    }

    const crl = latestCrl[0];

    // Check if CRL PEM exists
    if (!crl.crlPem) {
      reply.code(503);
      return { error: 'CRL not yet signed - signing with KMS-stored keys not yet implemented' };
    }

    // Convert to appropriate format
    let content: Buffer;
    let contentType: string;

    if (format === 'crl') {
      // PEM format
      content = Buffer.from(crl.crlPem, 'utf8');
      contentType = 'application/pkix-crl';
    } else {
      // DER format - convert PEM to DER
      // Remove PEM headers and decode base64
      const base64Data = crl.crlPem
        .replace(/-----BEGIN X509 CRL-----/, '')
        .replace(/-----END X509 CRL-----/, '')
        .replace(/\n/g, '')
        .trim();
      content = Buffer.from(base64Data, 'base64');
      contentType = 'application/pkix-crl';
    }

    // Set headers according to RFC 5280
    reply.header('Content-Type', contentType);
    reply.header('Last-Modified', crl.thisUpdate.toUTCString());
    reply.header('Expires', crl.nextUpdate.toUTCString());

    // Calculate Cache-Control max-age based on time until nextUpdate
    const now = new Date();
    const maxAge = Math.max(0, Math.floor((crl.nextUpdate.getTime() - now.getTime()) / 1000));
    reply.header('Cache-Control', `public, max-age=${maxAge}`);

    return content;
  } catch (error) {
    server.log.error({ error, caId }, 'Failed to serve CRL');
    reply.code(500);
    return { error: 'Internal server error while serving CRL' };
  }
});

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

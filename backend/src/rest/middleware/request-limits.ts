import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

function perMinute(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const tokenRequestsPerMinute = perMinute('API_TOKEN_REQUESTS_PER_MINUTE', 120);

export async function registerRequestLimits(server: FastifyInstance): Promise<void> {
  await server.register(rateLimit, {
    global: false,
    max: perMinute('API_IP_REQUESTS_PER_MINUTE', 600),
    timeWindow: 60_000,
  });
  const check = server.createRateLimit();
  server.addHook('onRequest', async (request, reply) => {
    const result = await check(request);
    if (!result.isAllowed && result.isExceeded) {
      return reply.header('Retry-After', result.ttlInSeconds).code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests from this IP address' },
      });
    }
  });
}

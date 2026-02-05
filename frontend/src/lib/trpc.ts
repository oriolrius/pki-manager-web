import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { getApiUrl } from './config';
import { getAccessToken } from './auth';

export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates headers for tRPC requests
 * Includes Authorization header with Bearer token if authenticated
 */
async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  try {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // Ignore errors - continue without auth header
  }

  return headers;
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: getApiUrl(),
        headers: getHeaders,
      }),
    ],
  });
}

// For backward compatibility - will be initialized after config loads
export let trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_API_URL || 'http://localhost:3000/trpc',
      headers: getHeaders,
    }),
  ],
});

export function initTrpcClient() {
  trpcClient = createTrpcClient();
  return trpcClient;
}

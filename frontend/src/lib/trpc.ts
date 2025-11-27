import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { getApiUrl } from './config';

export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: getApiUrl(),
      }),
    ],
  });
}

// For backward compatibility - will be initialized after config loads
export let trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_API_URL || 'http://localhost:3000/trpc',
    }),
  ],
});

export function initTrpcClient() {
  trpcClient = createTrpcClient();
  return trpcClient;
}

import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '../../../backend/src/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: import.meta.env.VITE_API_URL || 'http://localhost:3000/trpc',
    }),
  ],
});

import { createFileRoute, redirect } from '@tanstack/react-router';

// Preserve bookmarks to the former Kubernetes-only page.
export const Route = createFileRoute('/clusters')({
  beforeLoad: () => { throw redirect({ to: '/integrations' }); },
});

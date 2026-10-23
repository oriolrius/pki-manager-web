import { createFileRoute } from '@tanstack/react-router';
import { IntegrationsPage } from '@/components/IntegrationsPage';

export const Route = createFileRoute('/integrations')({
  component: IntegrationsPage,
});

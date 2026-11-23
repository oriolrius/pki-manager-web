import { createFileRoute } from '@tanstack/react-router';
import { FleetTokensPanel } from '@/components/ssh/FleetTokensPanel';

export const Route = createFileRoute('/ssh/tokens')({
  component: FleetTokensPanel,
});

import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/')({
  component: Index,
});

function Index() {
  const healthQuery = trpc.health.useQuery();

  return (
    <div className="px-4 py-6 sm:px-0">
      <Card>
        <CardHeader>
          <CardTitle>Welcome to PKI Manager</CardTitle>
          <CardDescription>
            A web-based Public Key Infrastructure management application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {healthQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
          {healthQuery.data && (
            <div className="rounded-md border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-900">
                Status: {healthQuery.data.status}
              </p>
              <p className="text-sm text-green-800">
                {healthQuery.data.message}
              </p>
              <p className="text-xs text-green-700 mt-2">
                {healthQuery.data.timestamp}
              </p>
            </div>
          )}
          {healthQuery.error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">
                Error connecting to backend
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <Button>Get Started</Button>
            <Button variant="outline">Learn More</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

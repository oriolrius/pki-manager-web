import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { getApiUrl } from '../lib/config';

export const Route = createFileRoute('/api-docs')({
  component: ApiDocsPage,
});

function ApiDocsPage() {
  const [spec, setSpec] = useState<object | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // getApiUrl() returns the tRPC endpoint (e.g., http://host:port/trpc)
    // Strip /trpc suffix to get base URL for REST endpoints
    const trpcUrl = getApiUrl();
    const baseUrl = trpcUrl.replace(/\/trpc$/, '');
    fetch(`${baseUrl}/api/v1/openapi.json`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch OpenAPI spec');
        return res.json();
      })
      .then((fetchedSpec) => {
        // Update the server URL in the spec to point to the backend
        // The spec has relative URL "/api/v1" which would use frontend origin
        const updatedSpec = {
          ...fetchedSpec,
          servers: [
            {
              url: `${baseUrl}/api/v1`,
              description: 'REST API v1',
            },
          ],
        };
        setSpec(updatedSpec);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-state">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading API documentation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6" data-testid="error-state">
        <h2 className="text-lg font-semibold text-destructive mb-2">Failed to load API documentation</h2>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!spec) return null;

  return (
    <div data-testid="swagger-container">
      <div className="swagger-wrapper bg-card rounded-lg border shadow-sm overflow-hidden">
        <SwaggerUI spec={spec} />
      </div>
    </div>
  );
}

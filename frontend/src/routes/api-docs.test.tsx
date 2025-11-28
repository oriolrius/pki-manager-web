import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock swagger-ui-react
vi.mock('swagger-ui-react', () => ({
  default: ({ spec }: { spec: object }) => (
    <div data-testid="swagger-ui">SwaggerUI Mock - {JSON.stringify(spec)}</div>
  ),
}));

// Mock the CSS import
vi.mock('swagger-ui-react/swagger-ui.css', () => ({}));

// We need to dynamically import the component after mocking
const renderApiDocsPage = async () => {
  const { Route } = await import('./api-docs');
  const ApiDocsPage = Route.options.component;
  return render(<ApiDocsPage />);
};

describe('ApiDocsPage', () => {
  const mockSpec = {
    openapi: '3.0.0',
    info: { title: 'PKI Manager API', version: '1.0.0' },
    paths: {},
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', async () => {
    // Create a promise that never resolves to keep loading state
    global.fetch = vi.fn(() => new Promise(() => {}));

    await renderApiDocsPage();

    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(screen.getByText('Loading API documentation...')).toBeInTheDocument();
  });

  it('renders SwaggerUI with fetched spec on success', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSpec),
      } as Response)
    );

    await renderApiDocsPage();

    await waitFor(() => {
      expect(screen.getByTestId('swagger-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('swagger-ui')).toBeInTheDocument();
    // Verify fetch was called with the OpenAPI endpoint (URL depends on env)
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/openapi.json'));
  });

  it('shows error state when fetch fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      } as Response)
    );

    await renderApiDocsPage();

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to load API documentation')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch OpenAPI spec')).toBeInTheDocument();
  });

  it('shows error state when network error occurs', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    await renderApiDocsPage();

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to load API documentation')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});

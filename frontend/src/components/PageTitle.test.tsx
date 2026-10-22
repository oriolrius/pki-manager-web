import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { PageTitle } from './PageTitle';

afterEach(() => {
  cleanup();
  document.title = '';
});

function setup(path: string) {
  const root = createRootRoute({ component: () => <><PageTitle /><Outlet /></> });
  const children = ['/', '/certificates', '/certificates/$id', '/cas/new', '/ssh/hosts/$id', '/callback', '/future-page'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => <div>Page</div> }),
  );
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: root.addChildren(children), history });
  render(<RouterProvider router={router} />);
  return { router, history };
}

describe('browser tab titles', () => {
  it('updates on navigation and browser back, without exposing IDs or query values', async () => {
    const { history } = setup('/certificates?token=private-value');
    await waitFor(() => expect(document.title).toBe('Certificates | PKI Manager'));

    await act(async () => { history.push('/certificates/private-id'); });
    await waitFor(() => expect(document.title).toBe('Certificate Details | PKI Manager'));

    await act(async () => { history.push('/cas/new'); });
    await waitFor(() => expect(document.title).toBe('Create Certificate Authority | PKI Manager'));

    await act(async () => { history.back(); });
    await waitFor(() => expect(document.title).toBe('Certificate Details | PKI Manager'));
  });

  it.each([
    ['/', 'Dashboard | PKI Manager'],
    ['/ssh/hosts/host-id', 'SSH Host Details | PKI Manager'],
    ['/callback', 'Signing In | PKI Manager'],
    ['/future-page', 'PKI Manager'],
  ])('sets the title on direct loading of %s', async (path, title) => {
    setup(path);
    await waitFor(() => expect(document.title).toBe(title));
  });
});

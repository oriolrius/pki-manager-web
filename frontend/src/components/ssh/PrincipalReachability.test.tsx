/**
 * TASK-249 — the Issue form panel "Where these principals grant login" asks
 * for ONE zone (the selected identity's) and shows only what that zone returns.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<{ input: unknown; opts: unknown }> }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    ssh: {
      principal: {
        mappingsByPrincipal: {
          useQuery: (input: { zone?: string }, opts: unknown) => {
            h.calls.push({ input, opts });
            const byZone: Record<string, Record<string, Array<{ fqdn: string; localAccount: string }>>> = {
              prod: { ops: [{ fqdn: 'web.prod.lab', localAccount: 'root' }] },
              staging: { ops: [{ fqdn: 'web.stg.lab', localAccount: 'admin' }] },
            };
            return { data: input?.zone ? byZone[input.zone] : undefined };
          },
        },
      },
    },
  },
}));

import { PrincipalReachability } from './PrincipalReachability';

beforeEach(() => {
  h.calls = [];
});

describe('PrincipalReachability (zone-scoped)', () => {
  it('queries the identity zone and lists only its hosts', () => {
    render(<PrincipalReachability principals={['ops']} zoneId="staging" />);
    expect(h.calls.at(-1)?.input).toEqual({ zone: 'staging' });
    expect(screen.getByText('Where these principals grant login')).toBeInTheDocument();
    expect(screen.getByText(/web\.stg\.lab \(admin\)/)).toBeInTheDocument();
    expect(screen.queryByText(/web\.prod\.lab/)).not.toBeInTheDocument();
  });

  it('does not query or render before an identity (zone) is chosen', () => {
    const { container } = render(<PrincipalReachability principals={['ops']} />);
    expect(h.calls.at(-1)?.opts).toEqual({ enabled: false });
    expect(container).toBeEmptyDOMElement();
  });
});

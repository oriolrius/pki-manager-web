import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { expect, it, vi } from 'vitest';
import { Route } from './cas.new';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/components/ui', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/lib/trpc', () => ({ trpc: {
  useUtils: () => ({}),
  ca: { create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
} }));

it('lists exactly the key usages the backend issues for a root CA (keyCertSign, cRLSign)', () => {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  const item = screen.getByText(/^Key Usage:/);
  expect(item.textContent).toContain('keyCertSign');
  expect(item.textContent).toContain('cRLSign');
  expect(item.textContent).not.toContain('digitalSignature');
});

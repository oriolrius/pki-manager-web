import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { SearchInput } from '@/components/ui';

export const Route = createFileRoute('/ssh/hosts')({
  component: SshHosts,
});

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  offboarded: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

function SshHosts() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isNew = matchRoute({ to: '/ssh/hosts/new' });
  const isDetail = matchRoute({ to: '/ssh/hosts/$id', fuzzy: false });

  const hostsQuery = trpc.ssh.host.list.useQuery();
  const [filter, setFilter] = useState('');

  if (isNew || isDetail) {
    return <Outlet />;
  }

  const hosts = hostsQuery.data ?? [];
  const q = filter.trim().toLowerCase();
  const filteredHosts = q
    ? hosts.filter(
        (h) =>
          h.fqdn.toLowerCase().includes(q) ||
          (h.displayName ?? '').toLowerCase().includes(q) ||
          h.addresses.some((a) => a.toLowerCase().includes(q)) ||
          h.status.toLowerCase().includes(q)
      )
    : hosts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">SSH Hosts</h2>
        <div className="flex items-center gap-2">
          {hosts.length > 0 && (
            <SearchInput
              className="w-64"
              value={filter}
              onChange={setFilter}
              placeholder="Filter hosts…"
              ariaLabel="Filter hosts"
            />
          )}
          <button
            onClick={() => navigate({ to: '/ssh/hosts/new' })}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm whitespace-nowrap"
          >
            Register Host
          </button>
        </div>
      </div>

      {hostsQuery.isLoading && <div className="text-center py-8 text-muted-foreground">Loading...</div>}
      {hostsQuery.isError && <div className="text-center py-8 text-destructive">Error loading hosts</div>}

      {hostsQuery.isSuccess && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">FQDN</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Addresses</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Certificate</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hosts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No hosts registered yet.
                  </td>
                </tr>
              ) : filteredHosts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No hosts match “{filter}”.
                  </td>
                </tr>
              ) : (
                filteredHosts.map((h) => (
                  <tr
                    key={h.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate({ to: '/ssh/hosts/$id', params: { id: h.id } })}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{h.fqdn}</div>
                      {h.displayName && <div className="text-xs text-muted-foreground">{h.displayName}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {h.addresses.length ? h.addresses.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {h.currentCertId ? (
                        <span className="text-green-700 dark:text-green-400">Active</span>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_STYLES[h.status] ?? STATUS_STYLES.offboarded
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

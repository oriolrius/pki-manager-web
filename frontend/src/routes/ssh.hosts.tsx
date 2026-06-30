import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

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

  if (isNew || isDetail) {
    return <Outlet />;
  }

  const hosts = hostsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">SSH Hosts</h2>
        <button
          onClick={() => navigate({ to: '/ssh/hosts/new' })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          Register Host
        </button>
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
              ) : (
                hosts.map((h) => (
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
                        <span className="text-green-600">Active</span>
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

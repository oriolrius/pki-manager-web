import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Info } from 'lucide-react';
import { useZone } from '@/lib/zone-context';

export const Route = createFileRoute('/ssh/cas')({
  component: SshCas,
});

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rotating: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  retired: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

function SshCas() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isNew = matchRoute({ to: '/ssh/cas/new' });
  const isDetail = matchRoute({ to: '/ssh/cas/$id', fuzzy: false });

  const { zoneId, isAll, zoneNameById } = useZone();
  const casQuery = trpc.ssh.ca.list.useQuery({ zoneId });

  if (isNew || isDetail) {
    return <Outlet />;
  }

  const cas = casQuery.data ?? [];
  const hasUser = cas.some((c) => c.caType === 'user' && c.status !== 'retired');
  const hasHost = cas.some((c) => c.caType === 'host' && c.status !== 'retired');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">SSH Certificate Authorities</h2>
        <div className="flex gap-2">
          <button
            onClick={() => navigate({ to: '/ssh/cas/new', search: { caType: 'user' } })}
            disabled={hasUser}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
          >
            Create User CA
          </button>
          <button
            onClick={() => navigate({ to: '/ssh/cas/new', search: { caType: 'host' } })}
            disabled={hasHost}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
          >
            Create Host CA
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-md bg-muted/50 border">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>
          SSH CAs are <strong>ECDSA nistp256</strong> only (PKCS#11 v2.40 / Cosmian KMS compatibility). One active CA
          per type; rotation keeps the predecessor trusted during overlap.
        </span>
      </div>

      {casQuery.isLoading && <div className="text-center py-8 text-muted-foreground">Loading...</div>}
      {casQuery.isError && (
        <div className="text-center py-8 text-destructive">Error loading SSH certificate authorities</div>
      )}

      {casQuery.isSuccess && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                {isAll && <th className="px-4 py-3 text-left text-sm font-medium">Zone</th>}
                <th className="px-4 py-3 text-left text-sm font-medium">Label</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Fingerprint (SHA256)</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Algorithm</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cas.length === 0 ? (
                <tr>
                  <td colSpan={isAll ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                    No SSH certificate authorities yet. Create a User CA and a Host CA to begin.
                  </td>
                </tr>
              ) : (
                cas.map((ca) => (
                  <tr
                    key={ca.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate({ to: '/ssh/cas/$id', params: { id: ca.id } })}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          ca.caType === 'user'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        }`}
                      >
                        {ca.caType === 'user' ? 'User CA' : 'Host CA'}
                      </span>
                    </td>
                    {isAll && (
                      <td className="px-4 py-3 text-sm">
                        <code className="text-xs font-mono">{zoneNameById(ca.zoneId)}</code>
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm">{ca.label || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs text-muted-foreground font-mono break-all">{ca.fingerprintSha256}</code>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono">{ca.keyAlgorithm}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_STYLES[ca.status] ?? STATUS_STYLES.retired
                        }`}
                      >
                        {ca.status}
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

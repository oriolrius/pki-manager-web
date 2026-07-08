import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useConfirm, useToast } from '@/components/ui';

export const Route = createFileRoute('/clusters')({
  component: ClustersPage,
});

function ClustersPage() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const toast = useToast();
  const clustersQuery = trpc.cluster.list.useQuery();
  const casQuery = trpc.ca.list.useQuery({ limit: 100, offset: 0 });

  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [caId, setCaId] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copyConfirm, setCopyConfirm] = useState(false);

  const registerMutation = trpc.cluster.register.useMutation({
    onSuccess: (data) => {
      setIssuedToken(data?.token ?? null);
      setName('');
      setDescription('');
      setCaId('');
      utils.cluster.list.invalidate();
    },
    onError: (err) => toast.error(`Failed to register cluster: ${err.message}`),
  });

  const revokeMutation = trpc.cluster.revoke.useMutation({
    onSuccess: () => {
      toast.success('Cluster token revoked');
      utils.cluster.list.invalidate();
    },
    onError: (err) => toast.error(`Failed to revoke cluster: ${err.message}`),
  });

  const copyToken = async () => {
    if (!issuedToken) return;
    await navigator.clipboard.writeText(issuedToken);
    setCopyConfirm(true);
    setTimeout(() => setCopyConfirm(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">K8s Clusters</h1>
          <p className="text-sm text-muted-foreground">
            Register clusters to consume the external issuer API for cert-manager.
          </p>
        </div>
        <button
          onClick={() => {
            setShowRegister(true);
            setIssuedToken(null);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          Register Cluster
        </button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">CA</th>
              <th className="px-4 py-2">Token Prefix</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last Seen</th>
              <th className="px-4 py-2">Certs Issued</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {clustersQuery.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {clustersQuery.data && clustersQuery.data.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No clusters registered.</td></tr>
            )}
            {clustersQuery.data?.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2 truncate max-w-xs" title={c.caSubjectDn}>{c.caSubjectDn}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.tokenPrefix}…</td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {c.lastSeen ? new Date(c.lastSeen).toLocaleString() : 'never'}
                </td>
                <td className="px-4 py-2">{c.k8sCertificatesCount}</td>
                <td className="px-4 py-2 text-right">
                  {c.status !== 'revoked' && (
                    <button
                      onClick={async () => {
                        const { confirmed } = await confirm({
                          title: `Revoke cluster "${c.name}"?`,
                          description: 'Token will stop working immediately.',
                          confirmLabel: 'Revoke',
                          tone: 'danger',
                        });
                        if (confirmed) {
                          revokeMutation.mutate({ id: c.id });
                        }
                      }}
                      className="text-destructive hover:underline text-xs"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showRegister && !issuedToken && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card border rounded-md p-6 w-[480px] space-y-4">
            <h2 className="text-lg font-semibold">Register Cluster</h2>
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-eu-cluster"
                className="w-full px-3 py-2 border rounded bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 border rounded bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Bound CA</label>
              <select
                value={caId}
                onChange={(e) => setCaId(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-background"
              >
                <option value="">Select CA…</option>
                {casQuery.data?.items
                  ?.filter((ca) => ca.status === 'active')
                  .map((ca) => (
                    <option key={ca.id} value={ca.id}>{ca.subjectDn}</option>
                  ))}
              </select>
            </div>
            {registerMutation.error && (
              <p className="text-sm text-destructive">{registerMutation.error.message}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRegister(false)}
                className="px-3 py-2 border rounded hover:bg-accent"
              >Cancel</button>
              <button
                disabled={!name || !caId || registerMutation.isPending}
                onClick={() => registerMutation.mutate({ name, description: description || undefined, caId })}
                className="px-3 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
              >
                {registerMutation.isPending ? 'Registering…' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}

      {issuedToken && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card border rounded-md p-6 w-[640px] space-y-4">
            <h2 className="text-lg font-semibold">Cluster Token</h2>
            <p className="text-sm text-destructive font-medium">
              This token is shown ONCE. Copy it now — you will not be able to retrieve it again.
            </p>
            <pre className="p-3 bg-muted rounded text-xs break-all whitespace-pre-wrap font-mono">{issuedToken}</pre>
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={copyToken}
                className="px-3 py-2 bg-primary text-primary-foreground rounded"
              >
                {copyConfirm ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button
                onClick={() => {
                  setIssuedToken(null);
                  setShowRegister(false);
                }}
                className="px-3 py-2 border rounded hover:bg-accent"
              >
                I have saved the token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active'
      ? 'bg-green-500/15 text-green-700 dark:text-green-400'
      : status === 'idle'
      ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
      : 'bg-red-500/15 text-red-700 dark:text-red-400';
  return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{status}</span>;
}

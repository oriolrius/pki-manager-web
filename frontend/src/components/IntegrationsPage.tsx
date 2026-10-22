import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useConfirm, useToast } from '@/components/ui';

export function IntegrationsPage() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const toast = useToast();
  const integrationsQuery = trpc.integration.list.useQuery();
  const casQuery = trpc.ca.list.useQuery({ limit: 100, offset: 0 });

  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'kubernetes' | 'scep' | 'generic'>('generic');
  const [description, setDescription] = useState('');
  const [caId, setCaId] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copyConfirm, setCopyConfirm] = useState(false);

  const registerMutation = trpc.integration.register.useMutation({
    onSuccess: (data) => {
      setIssuedToken(data?.token ?? null);
      setName('');
      setKind('generic');
      setDescription('');
      setCaId('');
      utils.integration.list.invalidate();
    },
    onError: (err) => toast.error(`Failed to create integration: ${err.message}`),
  });

  const revokeMutation = trpc.integration.revoke.useMutation({
    onSuccess: () => {
      toast.success('Service token revoked');
      utils.integration.list.invalidate();
    },
    onError: (err) => toast.error(`Failed to revoke service token: ${err.message}`),
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
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Create CA-bound service tokens for Kubernetes cert-manager, SCEP, and other integrations.
          </p>
        </div>
        <button
          onClick={() => {
            setShowRegister(true);
            setIssuedToken(null);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          Add Integration
        </button>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">CA</th>
              <th className="px-4 py-2">Token Prefix</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last Seen</th>
              <th className="px-4 py-2">Certs Issued</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {integrationsQuery.isLoading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {integrationsQuery.data && integrationsQuery.data.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No integrations configured.</td></tr>
            )}
            {integrationsQuery.data?.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">{c.kind === 'kubernetes' ? 'Kubernetes' : c.kind === 'scep' ? 'SCEP' : 'Generic'}</td>
                <td className="px-4 py-2 truncate max-w-xs" title={c.caSubjectDn}>{c.caSubjectDn}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.tokenPrefix}…</td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {c.lastSeen ? new Date(c.lastSeen).toLocaleString() : 'never'}
                </td>
                <td className="px-4 py-2">{c.certificatesCount}</td>
                <td className="px-4 py-2 text-right">
                  {c.status !== 'revoked' && (
                    <button
                      onClick={async () => {
                        const { confirmed } = await confirm({
                          title: `Revoke service token for "${c.name}"?`,
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
            <h2 className="text-lg font-semibold">Add Integration</h2>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="integration-kind">Type</label>
              <select id="integration-kind" value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="w-full px-3 py-2 border rounded bg-background">
                <option value="generic">Generic</option>
                <option value="kubernetes">Kubernetes cert-manager</option>
                <option value="scep">SCEP / MDM</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="integration-name">Name</label>
              <input
                id="integration-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="scep-mdm or prod-eu-cluster"
                className="w-full px-3 py-2 border rounded bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="integration-description">Description</label>
              <input
                id="integration-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 border rounded bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="integration-ca">Bound CA</label>
              <select
                id="integration-ca"
                value={caId}
                onChange={(e) => setCaId(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-background"
              >
                <option value="">Select CA…</option>
                {casQuery.data
                  ?.filter((ca) => ca.status === 'active')
                  .map((ca) => (
                    <option key={ca.id} value={ca.id}>{ca.subject}</option>
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
                onClick={() => registerMutation.mutate({ name, kind, description: description || undefined, caId })}
                className="px-3 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
              >
                {registerMutation.isPending ? 'Creating…' : 'Create Integration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {issuedToken && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card border rounded-md p-6 w-[640px] space-y-4">
            <h2 className="text-lg font-semibold">Service Token</h2>
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

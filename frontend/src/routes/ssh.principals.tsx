import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { ConfigSnippet } from '@/components/ConfigSnippet';

export const Route = createFileRoute('/ssh/principals')({
  component: SshPrincipals,
});

function SshPrincipals() {
  const utils = trpc.useUtils();
  const principalsQuery = trpc.ssh.principal.list.useQuery();
  const hostsQuery = trpc.ssh.host.list.useQuery();
  const staleQuery = trpc.ssh.principal.staleHosts.useQuery();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = trpc.ssh.principal.create.useMutation();
  const deleteMutation = trpc.ssh.principal.delete.useMutation();

  const principals = principalsQuery.data ?? [];
  const hosts = (hostsQuery.data ?? []).filter((h) => h.status !== 'offboarded');
  const staleIds = new Set((staleQuery.data ?? []).map((h) => h.id));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      {
        onSuccess: () => {
          utils.ssh.principal.list.invalidate();
          setName('');
          setDescription('');
        },
        onError: (err) => alert(`Failed: ${err.message}`),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this principal?')) return;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => utils.ssh.principal.list.invalidate(),
        onError: (err) => alert(`Failed: ${err.message}`),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Catalog */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Principal catalog</h2>
          <p className="text-sm text-muted-foreground">
            Principals (roles) are matched against AuthorizedPrincipalsFile on each host.
          </p>
        </div>
        <div className="p-4 space-y-4">
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="admins"
                className="w-full px-3 py-2 border rounded-md bg-background"
              />
            </div>
            <div className="flex-[2] min-w-[200px]">
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Production administrators"
                className="w-full px-3 py-2 border rounded-md bg-background"
              />
            </div>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </form>

          {principalsQuery.isLoading ? (
            <div className="text-center py-6 text-muted-foreground">Loading...</div>
          ) : principals.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">No principals yet.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {principals.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-mono">{p.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.description || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleDelete(p.id)}
                          aria-label={`Delete ${p.name}`}
                          className="text-destructive hover:opacity-70"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Per-host mapping + render */}
      <div className="space-y-3">
        <h2 className="font-semibold">Map principals to host accounts</h2>
        {hostsQuery.isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading hosts...</div>
        ) : hosts.length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-muted-foreground">No hosts registered.</div>
        ) : (
          hosts.map((host) => (
            <HostPrincipalCard
              key={host.id}
              hostId={host.id}
              fqdn={host.fqdn}
              principals={principals}
              stale={staleIds.has(host.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HostPrincipalCard({
  hostId,
  fqdn,
  principals,
  stale,
}: {
  hostId: string;
  fqdn: string;
  principals: { id: string; name: string }[];
  stale: boolean;
}) {
  const utils = trpc.useUtils();
  const renderQuery = trpc.ssh.principal.render.useQuery({ hostId });

  const [principalId, setPrincipalId] = useState('');
  const [localAccount, setLocalAccount] = useState('');

  const mapMutation = trpc.ssh.principal.map.useMutation();
  const markPushedMutation = trpc.ssh.principal.markPushed.useMutation();

  const render = renderQuery.data;

  const invalidate = () => {
    utils.ssh.principal.render.invalidate({ hostId });
    utils.ssh.principal.staleHosts.invalidate();
  };

  const handleMap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!principalId || !localAccount.trim()) return;
    mapMutation.mutate(
      { hostId, principalId, localAccount: localAccount.trim() },
      {
        onSuccess: () => {
          invalidate();
          setLocalAccount('');
          setPrincipalId('');
        },
        onError: (err) => alert(`Failed: ${err.message}`),
      }
    );
  };

  const handleMarkPushed = () => {
    markPushedMutation.mutate(
      { hostId },
      {
        onSuccess: invalidate,
        onError: (err) => alert(`Failed: ${err.message}`),
      }
    );
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <span className="font-medium">{fqdn}</span>
          {stale && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              <AlertTriangle className="h-3 w-3" />
              Stale — needs push
            </span>
          )}
        </div>
        {stale && (
          <button
            onClick={handleMarkPushed}
            disabled={markPushedMutation.isPending}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
          >
            Mark pushed
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <form onSubmit={handleMap} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="block text-sm font-medium mb-1">Principal</label>
            <select
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            >
              <option value="">Select…</option>
              {principals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-sm font-medium mb-1">Local account</label>
            <input
              type="text"
              value={localAccount}
              onChange={(e) => setLocalAccount(e.target.value)}
              placeholder="root"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={mapMutation.isPending || !principalId || !localAccount.trim()}
            className="px-4 py-2 border rounded-md hover:bg-muted text-sm disabled:opacity-50"
          >
            Map
          </button>
        </form>

        {renderQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading mapping...</p>
        ) : render && Object.keys(render.files).length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-mono">{render.directive}</p>
            {Object.entries(render.files).map(([account, contents]) => (
              <ConfigSnippet
                key={account}
                title={`/etc/ssh/auth_principals/${account}`}
                content={contents}
                downloadFilename={account}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No principal mappings for this host yet.</p>
        )}
      </div>
    </div>
  );
}

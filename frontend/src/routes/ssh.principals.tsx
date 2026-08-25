import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Callout } from '@/components/ssh/Callout';
import { HostPrincipalMappingCard, StalePill } from '@/components/ssh/HostPrincipalMappingCard';
import { useToast, useConfirm } from '@/components/ui';

export const Route = createFileRoute('/ssh/principals')({
  component: SshPrincipals,
});

function SshPrincipals() {
  const toast = useToast();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const principalsQuery = trpc.ssh.principal.list.useQuery();
  const hostsQuery = trpc.ssh.host.list.useQuery();
  const staleQuery = trpc.ssh.principal.staleHosts.useQuery();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedHostId, setSelectedHostId] = useState('');
  const createMutation = trpc.ssh.principal.create.useMutation();
  const deleteMutation = trpc.ssh.principal.delete.useMutation();

  const principals = principalsQuery.data ?? [];
  const hosts = (hostsQuery.data ?? []).filter((h) => h.status !== 'offboarded');
  const staleIds = new Set((staleQuery.data ?? []).map((h) => h.id));
  // Fall back to the first host so the page always shows a mapping form once hosts load.
  const selectedHost = hosts.find((h) => h.id === selectedHostId) ?? hosts[0];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Principal "${name.trim()}" created`);
          utils.ssh.principal.list.invalidate();
          setName('');
          setDescription('');
        },
        onError: (err) => toast.error(`Failed: ${err.message}`),
      }
    );
  };

  const handleDelete = async (id: string) => {
    const { confirmed } = await confirm({
      title: 'Delete this principal?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => utils.ssh.principal.list.invalidate(),
        onError: (err) => toast.error(`Failed: ${err.message}`),
      }
    );
  };

  return (
    <div className="space-y-6">
      <Callout tone="warn" title="A login needs the principal in two places">
        For a user to log in, the same principal must be in <strong>both</strong> their certificate <em>and</em> this
        host's <code className="font-mono">/etc/ssh/auth_principals/&lt;account&gt;</code> file. Mapping it here renders
        that file; deploy it to the host (and click <strong>Mark pushed</strong>). A principal mapped in only one place
        authenticates but is denied login.
      </Callout>

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

      {/* Per-host mapping + render: pick a host, then configure it. */}
      <div className="space-y-3">
        <h2 className="font-semibold">Map principals to host accounts</h2>
        {hostsQuery.isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading hosts...</div>
        ) : hosts.length === 0 ? (
          <div className="rounded-lg border p-6 text-center text-muted-foreground">No hosts registered.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,18rem)_1fr] items-start">
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="p-3 border-b">
                <h3 className="text-sm font-medium">Hosts</h3>
                <p className="text-xs text-muted-foreground">
                  {staleIds.size > 0 ? `${staleIds.size} need a push` : 'All pushed'}
                </p>
              </div>
              <ul className="divide-y max-h-[28rem] overflow-y-auto">
                {hosts.map((host) => {
                  const active = selectedHost?.id === host.id;
                  return (
                    <li key={host.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedHostId(host.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors ${
                          active ? 'bg-primary/10' : ''
                        }`}
                      >
                        <div className="text-sm font-medium truncate">{host.fqdn}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{host.status}</span>
                          {staleIds.has(host.id) && <StalePill />}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {selectedHost && (
              <HostPrincipalMappingCard key={selectedHost.id} hostId={selectedHost.id} title={selectedHost.fqdn} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

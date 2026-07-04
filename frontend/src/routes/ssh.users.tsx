import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, UserX } from 'lucide-react';
import { HostKrlStatePill } from '@/components/ssh/HostKrlStatePill';
import { blockFlow, unblockFlow, type BlockFlowDeps } from '@/components/ssh/block-flows';

export const Route = createFileRoute('/ssh/users')({
  component: SshUsers,
});

function SshUsers() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isNew = matchRoute({ to: '/ssh/users/new' });

  const utils = trpc.useUtils();
  const identitiesQuery = trpc.ssh.user.listIdentities.useQuery();

  const [newSubject, setNewSubject] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const createMutation = trpc.ssh.user.createIdentity.useMutation();
  const disableMutation = trpc.ssh.user.disableIdentity.useMutation();

  if (isNew) {
    return <Outlet />;
  }

  const identities = identitiesQuery.data ?? [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { subject: newSubject.trim(), email: newEmail.trim() || undefined },
      {
        onSuccess: () => {
          utils.ssh.user.listIdentities.invalidate();
          setNewSubject('');
          setNewEmail('');
          setShowCreate(false);
        },
        onError: (err) => alert(`Failed to create identity: ${err.message}`),
      }
    );
  };

  const handleDisable = (identityId: string) => {
    if (!confirm('Disable this identity? It will no longer be able to receive new certificates.')) return;
    disableMutation.mutate(
      { id: identityId },
      {
        onSuccess: () => utils.ssh.user.listIdentities.invalidate(),
        onError: (err) => alert(`Failed: ${err.message}`),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">SSH User Identities</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted font-medium"
          >
            <Plus className="h-4 w-4" />
            New Identity
          </button>
          <button
            onClick={() => navigate({ to: '/ssh/users/new' })}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
          >
            Issue Certificate
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-lg border bg-card p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1">Subject *</label>
            <input
              type="text"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              required
              placeholder="alice"
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1">Email (optional)</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="alice@example.com"
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {identitiesQuery.isLoading && <div className="text-center py-8 text-muted-foreground">Loading...</div>}
      {identitiesQuery.isError && <div className="text-center py-8 text-destructive">Error loading identities</div>}

      {identitiesQuery.isSuccess && (
        <div className="space-y-3">
          {identities.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">No identities yet.</div>
          ) : (
            identities.map((identity) => (
              <IdentityCard
                key={identity.id}
                identity={identity}
                onDisable={() => handleDisable(identity.id)}
                onIssue={() => navigate({ to: '/ssh/users/new', search: { identityId: identity.id } })}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function IdentityCard({
  identity,
  onDisable,
  onIssue,
}: {
  identity: { id: string; subject: string; email: string | null; status: string; createdAt: string };
  onDisable: () => void;
  onIssue: () => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const certsQuery = trpc.ssh.user.listCertificates.useQuery(
    { identityId: identity.id },
    { enabled: open }
  );
  const certs = certsQuery.data ?? [];

  // BLK-09: "Blocked on:" host pills + pre-emptive "Block on host…" select.
  const blocksQuery = trpc.ssh.block.listForIdentity.useQuery({ id: identity.id }, { enabled: open });
  const hostsQuery = trpc.ssh.host.list.useQuery(undefined, { enabled: open });
  const fleetQuery = trpc.ssh.block.fleetDistribution.useQuery(undefined, { enabled: open });
  const blockMutation = trpc.ssh.block.block.useMutation();
  const unblockMutation = trpc.ssh.block.unblock.useMutation();
  const [blockHostId, setBlockHostId] = useState('');
  const blocks = blocksQuery.data ?? [];
  const blockableHosts = (hostsQuery.data ?? []).filter(
    (h) => h.status !== 'offboarded' && !blocks.some((b) => b.hostId === h.id)
  );

  const deps: BlockFlowDeps = {
    confirmFn: (m) => confirm(m),
    promptFn: (m) => prompt(m),
    alertFn: (m) => alert(m),
    fetchCollisions: (identityId) => utils.client.ssh.block.collisions.query({ id: identityId }),
    block: (input) => blockMutation.mutateAsync(input),
    unblock: (input) => unblockMutation.mutateAsync(input),
    invalidate: () => {
      utils.ssh.block.listForIdentity.invalidate({ id: identity.id });
      utils.ssh.block.fleetDistribution.invalidate();
      utils.ssh.host.access.invalidate();
    },
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between p-4">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <div>
            <div className="font-medium">{identity.subject}</div>
            <div className="text-xs text-muted-foreground">
              {identity.email || 'no email'}
              {open ? ` · ${certs.length} certificate${certs.length === 1 ? '' : 's'}` : ' · click to view certificates'}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
              identity.status === 'active'
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
            }`}
          >
            {identity.status}
          </span>
          <button onClick={onIssue} className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted">
            Issue
          </button>
          {identity.status === 'active' && (
            <button
              onClick={onDisable}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-muted text-destructive"
            >
              <UserX className="h-3.5 w-3.5" />
              Disable
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t px-4 py-3 space-y-3">
          <div className="flex items-center flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Blocked on:</span>
            {blocks.length === 0 ? (
              <span className="text-xs text-muted-foreground">no hosts</span>
            ) : (
              blocks.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                >
                  {b.fqdn}
                  <HostKrlStatePill state={b.state} />
                  {b.supersededByOffboard && <span className="text-muted-foreground">(superseded)</span>}
                  <button
                    onClick={() =>
                      unblockFlow(deps, {
                        hostId: b.hostId,
                        fqdn: b.fqdn ?? b.hostId,
                        identityId: identity.id,
                        subject: identity.subject,
                      })
                    }
                    disabled={unblockMutation.isPending}
                    title={`Unblock ${identity.subject} on ${b.fqdn ?? b.hostId}`}
                    aria-label={`Unblock ${identity.subject} on ${b.fqdn ?? b.hostId}`}
                    className="ml-0.5 rounded-full hover:bg-red-200 dark:hover:bg-red-800 leading-none px-1 disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <select
                value={blockHostId}
                onChange={(e) => setBlockHostId(e.target.value)}
                className="px-2 py-1 border rounded-md bg-background text-xs"
              >
                <option value="">Block on host…</option>
                {blockableHosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.fqdn}
                  </option>
                ))}
              </select>
              <button
                disabled={!blockHostId || blockMutation.isPending}
                onClick={async () => {
                  const host = blockableHosts.find((h) => h.id === blockHostId);
                  if (!host) return;
                  const fleetState = fleetQuery.data?.find((r) => r.hostId === host.id)?.state.state;
                  const ok = await blockFlow(deps, {
                    hostId: host.id,
                    fqdn: host.fqdn,
                    identityId: identity.id,
                    subject: identity.subject,
                    hostState: fleetState ?? 'unknown',
                  });
                  if (ok) setBlockHostId('');
                }}
                className="px-2 py-1 text-xs border rounded-md hover:bg-muted disabled:opacity-50"
              >
                Block
              </button>
            </span>
          </div>

          {certsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading certificates...</p>
          ) : certs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No certificates issued for this identity.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium py-1">Serial</th>
                  <th className="text-left font-medium py-1">Principals</th>
                  <th className="text-left font-medium py-1">Status</th>
                  <th className="text-left font-medium py-1">Valid before</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5 font-mono text-xs">{c.serial}</td>
                    <td className="py-1.5 font-mono text-xs">{(c.principals ?? []).join(', ')}</td>
                    <td className="py-1.5">{c.status}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {new Date(c.validBefore).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Host Access card (BLK-09, decision-016): who can currently reach this host
 * (entitlement join), per-row Block; blocked identities as red rows with
 * reason / by / when / state and Unblock; a pre-emptive "Block user…" dropdown
 * for identities not currently entitled. One verb pair, no KRL mechanics.
 */
import { useState } from 'react';
import { ShieldBan } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast, useConfirm } from '@/components/ui';
import { HostKrlStatePill } from './HostKrlStatePill';
import { blockFlow, unblockFlow, type BlockFlowDeps } from './block-flows';

export function HostAccessCard({ hostId }: { hostId: string }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const confirm = useConfirm();
  const accessQuery = trpc.ssh.host.access.useQuery({ id: hostId });
  const identitiesQuery = trpc.ssh.user.listIdentities.useQuery();
  const blockMutation = trpc.ssh.block.block.useMutation();
  const unblockMutation = trpc.ssh.block.unblock.useMutation();
  const [preemptiveId, setPreemptiveId] = useState('');

  const access = accessQuery.data;

  const deps: BlockFlowDeps = {
    confirmFn: async (m) => (await confirm({ description: m, confirmLabel: 'Confirm' })).confirmed,
    promptFn: async (m) => {
      const r = await confirm({ description: m, reason: { placeholder: 'Optional' }, confirmLabel: 'Continue' });
      return r.confirmed ? r.reason ?? '' : null;
    },
    alertFn: (m, variant) => (variant === 'error' ? toast.error(m) : toast.success(m)),
    fetchCollisions: (identityId) => utils.client.ssh.block.collisions.query({ id: identityId }),
    block: (input) => blockMutation.mutateAsync(input),
    unblock: (input) => unblockMutation.mutateAsync(input),
    invalidate: () => {
      utils.ssh.host.access.invalidate({ id: hostId });
      utils.ssh.block.listForHost.invalidate({ hostId });
      utils.ssh.block.listForIdentity.invalidate();
      utils.ssh.block.fleetDistribution.invalidate();
      utils.ssh.host.get.invalidate({ id: hostId });
    },
  };

  if (accessQuery.isLoading) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading access…</div>;
  }
  if (accessQuery.isError || !access) return null;

  const entryIds = new Set(access.entries.map((e) => e.identityId));
  const candidates = (identitiesQuery.data ?? []).filter((i) => !entryIds.has(i.id));

  const doBlock = (identityId: string, subject: string) =>
    blockFlow(deps, { hostId, fqdn: access.fqdn, identityId, subject, hostState: access.state.state });
  const doUnblock = (identityId: string, subject: string) =>
    unblockFlow(deps, { hostId, fqdn: access.fqdn, identityId, subject });

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldBan className="h-4 w-4" />
          <h2 className="font-semibold">Access</h2>
          <HostKrlStatePill state={access.state} />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={preemptiveId}
            onChange={(e) => setPreemptiveId(e.target.value)}
            className="px-3 py-1.5 border rounded-md bg-background text-sm"
          >
            <option value="">Block user…</option>
            {candidates.map((i) => (
              <option key={i.id} value={i.id}>
                {i.subject}
              </option>
            ))}
          </select>
          <button
            disabled={!preemptiveId || blockMutation.isPending}
            onClick={async () => {
              const ident = candidates.find((i) => i.id === preemptiveId);
              if (!ident) return;
              if (await doBlock(ident.id, ident.subject)) setPreemptiveId('');
            }}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
          >
            Block
          </button>
        </div>
      </div>

      {access.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No identity can currently reach this host (no role is mapped to a local account here).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="text-left font-medium py-1.5 pr-3">Identity</th>
                <th className="text-left font-medium py-1.5 pr-3">Via / as</th>
                <th className="text-left font-medium py-1.5 pr-3">By, when</th>
                <th className="text-left font-medium py-1.5 pr-3">State</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {access.entries.map((e) => (
                <tr key={e.identityId} className={e.blocked ? 'bg-red-50 dark:bg-red-900/20' : undefined}>
                  <td className="py-2 pr-3 font-medium">
                    {e.subject}
                    {e.identityStatus !== 'active' && <span className="ml-1 text-xs text-muted-foreground">(disabled)</span>}
                    {e.block?.supersededByOffboard && (
                      <span className="ml-1 text-xs text-muted-foreground">(superseded by offboard)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {e.blocked ? (
                      <span className="text-red-700 dark:text-red-300">
                        (blocked){e.block?.reason ? ` — ${e.block.reason}` : ''}
                      </span>
                    ) : e.viaRoles.length ? (
                      <span className="font-mono">
                        {e.viaRoles.join(', ')} → {e.localAccounts.join(', ')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {e.block ? `${e.block.createdBy ?? '—'}, ${new Date(e.block.createdAt).toLocaleString()}` : ''}
                  </td>
                  <td className="py-2 pr-3">
                    {e.blocked ? <HostKrlStatePill state={access.state} /> : <span className="text-xs">allowed</span>}
                  </td>
                  <td className="py-2 text-right">
                    {e.blocked ? (
                      <button
                        onClick={() => doUnblock(e.identityId, e.subject)}
                        disabled={unblockMutation.isPending}
                        className="px-3 py-1 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
                      >
                        Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => doBlock(e.identityId, e.subject)}
                        disabled={blockMutation.isPending}
                        className="px-3 py-1 text-sm border rounded-md hover:bg-muted text-destructive disabled:opacity-50"
                      >
                        Block
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

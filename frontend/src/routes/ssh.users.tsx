import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, UserX, Info, Copy, Check, ShieldOff } from 'lucide-react';
import { HostKrlStatePill } from '@/components/ssh/HostKrlStatePill';
import { blockFlow, unblockFlow, type BlockFlowDeps } from '@/components/ssh/block-flows';
import { useToast, useConfirm } from '@/components/ui';

export const Route = createFileRoute('/ssh/users')({
  component: SshUsers,
});

function SshUsers() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isNew = matchRoute({ to: '/ssh/users/new' });

  const utils = trpc.useUtils();
  const toast = useToast();
  const confirm = useConfirm();
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
        onError: (err) => toast.error(`Failed to create identity: ${err.message}`),
      }
    );
  };

  const handleDisable = async (identityId: string) => {
    const { confirmed } = await confirm({
      title: 'Disable identity?',
      description: 'It will no longer be able to receive new certificates.',
      confirmLabel: 'Disable',
      tone: 'danger',
    });
    if (!confirmed) return;
    disableMutation.mutate(
      { id: identityId },
      {
        onSuccess: () => utils.ssh.user.listIdentities.invalidate(),
        onError: (err) => toast.error(`Failed to disable identity: ${err.message}`),
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

/** Hover- AND click-triggered info popover (accessible + touch-friendly). */
function InfoTip({
  children,
  label,
  placement = 'right',
}: {
  children: React.ReactNode;
  label?: string;
  placement?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label ?? 'More info'}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-5 z-30 w-72 rounded-md border bg-popover p-3 text-xs font-normal leading-relaxed text-popover-foreground shadow-md ${
            placement === 'left' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}

const CERT_STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  expired: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

/** A cert past validBefore is effectively expired even if the DB row still says active. */
function effectiveStatus(c: { status: string; validBefore: string }): string {
  if (c.status === 'revoked') return 'revoked';
  if (new Date(c.validBefore).getTime() < Date.now()) return 'expired';
  return c.status;
}

function StatusPill({ status, title }: { status: string; title?: string }) {
  const cls = CERT_STATUS_STYLES[status] ?? CERT_STATUS_STYLES.active;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls} ${
        title ? 'cursor-help' : ''
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

/** Scannable relative expiry ("in 29 days" / "3 days ago") with urgency colouring. */
function relativeExpiry(iso: string): { text: string; tone: string } {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const day = 86_400_000;
  const hr = 3_600_000;
  const min = 60_000;
  let n: number;
  let unit: string;
  if (abs >= day) {
    n = Math.round(abs / day);
    unit = 'day';
  } else if (abs >= hr) {
    n = Math.round(abs / hr);
    unit = 'hour';
  } else {
    n = Math.max(1, Math.round(abs / min));
    unit = 'min';
  }
  const label = `${n} ${unit}${unit !== 'min' && n !== 1 ? 's' : ''}`;
  const text = ms >= 0 ? `in ${label}` : `${label} ago`;
  let tone = 'text-muted-foreground';
  if (ms >= 0 && ms < day) tone = 'text-red-600 dark:text-red-400';
  else if (ms >= 0 && ms < 7 * day) tone = 'text-amber-600 dark:text-amber-400';
  return { text, tone };
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
  const toast = useToast();
  const confirm = useConfirm();
  const certsQuery = trpc.ssh.user.listCertificates.useQuery(
    { identityId: identity.id },
    { enabled: open }
  );
  const certs = certsQuery.data ?? [];

  // Certificate table: reveal first 3, "Show more" expands the rest (already fetched).
  const [showAllCerts, setShowAllCerts] = useState(false);
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);
  const revokeCertMutation = trpc.ssh.user.revoke.useMutation();
  const visibleCerts = showAllCerts ? certs : certs.slice(0, 3);
  const handleRevokeCert = async (certId: string, serial: string) => {
    const { confirmed, reason } = await confirm({
      title: `Revoke certificate #${serial}?`,
      description: 'This adds it to the KRL and cannot be undone.',
      confirmLabel: 'Revoke',
      tone: 'danger',
      reason: { label: 'Revocation reason (optional)', placeholder: 'e.g. key compromise' },
    });
    if (!confirmed) return;
    revokeCertMutation.mutate(
      { certId, reason },
      {
        onSuccess: () => {
          toast.success(`Certificate #${serial} revoked`);
          utils.ssh.user.listCertificates.invalidate({ identityId: identity.id });
        },
        onError: (e) => toast.error(`Failed to revoke: ${e.message}`),
      }
    );
  };
  const copySerial = (s: string) => {
    navigator.clipboard?.writeText(s);
    setCopiedSerial(s);
    setTimeout(() => setCopiedSerial((cur) => (cur === s ? null : cur)), 1200);
  };

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
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-medium">Access blocks</h4>
              <InfoTip label="About access blocks" placement="right">
                <p>
                  Blocking denies this user's SSH login on the chosen host <strong>only</strong> —
                  access to every other host is unaffected. A block takes effect when that host next
                  pulls the KRL; until then its state shows Pending or Unknown.
                </p>
              </InfoTip>
              {blocks.length > 0 && <span className="text-xs text-muted-foreground">({blocks.length})</span>}
            </div>

            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not blocked on any host — can reach every host their roles allow.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {blocks.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{b.fqdn ?? b.hostId}</span>
                        <HostKrlStatePill state={b.state} />
                        {b.supersededByOffboard && (
                          <span className="text-xs text-muted-foreground">(superseded by offboard)</span>
                        )}
                      </div>
                      {b.reason && <p className="text-xs text-foreground/80">“{b.reason}”</p>}
                      <p className="text-xs text-muted-foreground">
                        by {b.createdBy ?? 'unknown'}
                        {b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
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
                      className="shrink-0 rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="text-xs text-muted-foreground">Block on another host:</span>
              {blockableHosts.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {blocks.length > 0 ? 'Blocked on all active hosts.' : 'No hosts available.'}
                </span>
              ) : (
                <>
                  <select
                    value={blockHostId}
                    onChange={(e) => setBlockHostId(e.target.value)}
                    className="px-2 py-1 border rounded-md bg-background text-xs"
                  >
                    <option value="">Select host…</option>
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
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-medium">Issued certificates</h4>
              <InfoTip label="About this table" placement="right">
                <p>
                  Every SSH certificate signed for this user. Each row is one certificate: its
                  serial, the principals (Linux usernames) it lets them log in as, its status, and
                  when it expires. Certificates are short-lived by design — expiry is the main way
                  access is revoked.
                </p>
              </InfoTip>
              {!certsQuery.isLoading && certs.length > 0 && (
                <span className="text-xs text-muted-foreground">({certs.length})</span>
              )}
            </div>

            {certsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading certificates...</p>
            ) : certs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No certificates issued for this identity.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium py-1">Serial</th>
                      <th className="text-left font-medium py-1">Key ID</th>
                      <th className="text-left font-medium py-1">Principals</th>
                      <th className="text-left font-medium py-1">Status</th>
                      <th className="text-left font-medium py-1">Expires</th>
                      <th className="text-right font-medium py-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCerts.map((c) => {
                      const status = effectiveStatus(c);
                      const rel = relativeExpiry(c.validBefore);
                      const full = new Date(c.validBefore).toLocaleString();
                      const revokedTitle =
                        status === 'revoked'
                          ? `Revoked${c.revocationDate ? ' on ' + new Date(c.revocationDate).toLocaleString() : ''} — ${
                              c.revocationReason || 'no reason given'
                            }`
                          : undefined;
                      return (
                        <tr key={c.id} className="border-t align-top">
                          <td className="py-1.5 font-mono text-xs">{c.serial}</td>
                          <td className="py-1.5 font-mono text-xs">{c.keyId}</td>
                          <td className="py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {(c.principals ?? []).map((p: string) => (
                                <span
                                  key={p}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-mono bg-muted text-foreground/80"
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-1.5">
                            <StatusPill status={status} title={revokedTitle} />
                          </td>
                          <td className="py-1.5">
                            <span className={`text-xs ${rel.tone}`} title={full}>
                              {rel.text}
                            </span>
                          </td>
                          <td className="py-1.5">
                            <div className="flex items-center justify-end gap-2">
                              <InfoTip label="Certificate options" placement="left">
                                <div className="space-y-1">
                                  <div className="font-medium">Extensions</div>
                                  {c.extensions?.length ? (
                                    <ul className="list-disc pl-4">
                                      {c.extensions.map((e: string) => (
                                        <li key={e}>{e}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="text-muted-foreground">none</div>
                                  )}
                                  {Object.keys(c.criticalOptions ?? {}).length > 0 && (
                                    <>
                                      <div className="font-medium pt-1">Critical options</div>
                                      <ul className="list-disc pl-4">
                                        {Object.entries(c.criticalOptions).map(([k, v]) => (
                                          <li key={k}>
                                            {k}: {String(v)}
                                          </li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              </InfoTip>
                              <button
                                onClick={() => copySerial(c.serial)}
                                title="Copy serial"
                                aria-label="Copy serial"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {copiedSerial === c.serial ? (
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {status !== 'revoked' && (
                                <button
                                  onClick={() => handleRevokeCert(c.id, c.serial)}
                                  disabled={revokeCertMutation.isPending}
                                  title="Revoke certificate"
                                  aria-label="Revoke certificate"
                                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50"
                                >
                                  <ShieldOff className="h-3.5 w-3.5" />
                                  Revoke
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {certs.length > 3 && (
                  <button
                    onClick={() => setShowAllCerts((s) => !s)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAllCerts ? 'Show less' : `Show ${certs.length - 3} more`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

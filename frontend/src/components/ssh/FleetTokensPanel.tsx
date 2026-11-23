import { useState } from 'react';
import { KeyRound, Copy, Check, Plus, AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast, useConfirm } from '@/components/ui';
import { useZone } from '@/lib/zone-context';
import { Callout } from '@/components/ssh/Callout';
import {
  TOKEN_OPS,
  TOKEN_PRESETS,
  needsHostCa,
  needsUserCa,
  validateMint,
  type SshTokenOp,
  DEFAULT_CI_MAX_LIFETIME,
  LIFETIME_PRESETS,
  UNRESTRICTED_WARNING,
  UNRESTRICTED_HINT,
  formatLifetime,
  isUnrestrictedSignUser,
} from '@/components/ssh/fleet-token';

const inputCls = 'w-full px-3 py-2 border rounded-md bg-background';

/**
 * SSH fleet tokens (TASK-244): list / mint / revoke the bearer tokens the
 * external signing API accepts. The plaintext token exists ONLY in this
 * component's state, after mint and until the user dismisses the panel: it is
 * never put in the URL, localStorage or the react-query mutation cache.
 */
export function FleetTokensPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const { zoneId, isAll, zoneNameById } = useZone();

  const tokensQuery = trpc.ssh.token.list.useQuery();
  const casQuery = trpc.ssh.ca.list.useQuery({ zoneId });
  const mintMutation = trpc.ssh.token.mint.useMutation();
  const revokeMutation = trpc.ssh.token.revoke.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [ops, setOps] = useState<SshTokenOp[]>([]);
  const [hostCaId, setHostCaId] = useState('');
  const [userCaId, setUserCaId] = useState('');
  // sign-user limits (TASK-247). '' lifetime = no limit.
  const [allowedPrincipals, setAllowedPrincipals] = useState<string[]>([]);
  const [maxLifetime, setMaxLifetime] = useState(String(DEFAULT_CI_MAX_LIFETIME));
  const [secret, setSecret] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const cas = (casQuery.data ?? []).filter((c) => c.status === 'active');
  const hostCas = cas.filter((c) => c.caType === 'host');
  const userCas = cas.filter((c) => c.caType === 'user');
  const caById = new Map((casQuery.data ?? []).map((c) => [c.id, c] as const));
  const caName = (id: string | null) => {
    if (!id) return null;
    const ca = caById.get(id);
    return ca?.label || ca?.fingerprintSha256?.slice(0, 16) || id;
  };
  const caOptionLabel = (c: { label?: string | null; fingerprintSha256: string; zoneId: string }) =>
    `${c.label || c.fingerprintSha256.slice(0, 16)}${isAll ? ` (${zoneNameById(c.zoneId)})` : ''}`;

  // The list endpoint is not zone-filtered: scope it to the selected zone here.
  const tokens = (tokensQuery.data ?? []).filter((t) => isAll || t.zoneId === zoneId);

  // Least privilege: a CA is bound to the token only when one of its ops needs it.
  const hostNeeded = needsHostCa(ops);
  const userNeeded = needsUserCa(ops);
  const effHostCa = hostNeeded ? hostCaId || (hostCas.length === 1 ? hostCas[0].id : '') : '';
  const effUserCa = userNeeded ? userCaId || (userCas.length === 1 ? userCas[0].id : '') : '';
  const problem = validateMint({ name, ops, hostCaId: effHostCa, userCaId: effUserCa });
  // "All zones": the backend infers the zone from the CAs, so a mixed pair is a mistake.
  const zoneMismatch =
    effHostCa && effUserCa
      ? caById.get(effHostCa)?.zoneId !== caById.get(effUserCa)?.zoneId
      : false;

  // The allowed principals come from the token zone's catalog: the zone of the
  // chosen User CA, else the selected zone.
  const tokenZoneId = (effUserCa && caById.get(effUserCa)?.zoneId) || zoneId;
  const catalogQuery = trpc.ssh.principal.list.useQuery(
    { zoneId: tokenZoneId },
    { enabled: userNeeded && !!tokenZoneId }
  );
  const catalog = catalogQuery.data ?? [];
  const noLimits = userNeeded && allowedPrincipals.length === 0 && !maxLifetime;
  const togglePrincipal = (name: string) =>
    setAllowedPrincipals((cur) => (cur.includes(name) ? cur.filter((p) => p !== name) : [...cur, name]));

  const toggleOp = (op: SshTokenOp) => setOps((cur) => (cur.includes(op) ? cur.filter((o) => o !== op) : [...cur, op]));

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || zoneMismatch) return;
    try {
      const res = await mintMutation.mutateAsync({
        name: name.trim(),
        opSet: ops,
        hostCaId: effHostCa || undefined,
        userCaId: effUserCa || undefined,
        zone: zoneId,
        allowedPrincipals: userNeeded && allowedPrincipals.length ? allowedPrincipals : undefined,
        maxValidForSeconds: userNeeded && maxLifetime ? Number(maxLifetime) : undefined,
      });
      mintMutation.reset(); // drop the plaintext from the mutation cache right away
      setSecret({ token: res.token, name: res.record.name });
      setCopied(false);
      setShowForm(false);
      setName('');
      setOps([]);
      setHostCaId('');
      setUserCaId('');
      setAllowedPrincipals([]);
      setMaxLifetime(String(DEFAULT_CI_MAX_LIFETIME));
      utils.ssh.token.list.invalidate();
    } catch (err) {
      toast.error(`Failed to mint token: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the token and copy it by hand.');
    }
  };

  const handleRevoke = async (t: { id: string; name: string }) => {
    const { confirmed } = await confirm({
      title: `Revoke token "${t.name}"?`,
      description:
        'Every host or pipeline that uses this token loses access to the signing API at once. This cannot be undone: mint a new token to restore access.',
      confirmLabel: 'Revoke token',
      tone: 'danger',
    });
    if (!confirmed) return;
    revokeMutation.mutate(
      { id: t.id },
      {
        onSuccess: () => {
          toast.success(`Token "${t.name}" revoked`);
          utils.ssh.token.list.invalidate();
        },
        onError: (err) => toast.error(`Failed to revoke token: ${err.message}`),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Fleet tokens</h2>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Mint token
        </button>
      </div>

      <Callout title="What a fleet token is">
        A fleet token lets a host or a CI pipeline call the signing API without a person logging in. Each token is
        bound to one zone, to its CAs and to a fixed set of operations. Keep it in Ansible Vault or another secret store.
      </Callout>

      {secret && (
        <div role="alert" className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 space-y-3 dark:bg-amber-900/20 dark:border-amber-700">
          <div className="font-medium text-amber-900 dark:text-amber-200">
            Token “{secret.name}” created. Copy it now.
          </div>
          <div className="flex items-center gap-2">
            <code
              data-testid="minted-token"
              className="flex-1 break-all rounded-md border bg-background px-3 py-2 font-mono text-xs"
            >
              {secret.token}
            </code>
            <button
              onClick={copySecret}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-amber-900 dark:text-amber-200">
            <strong>You will not see this token again.</strong> PKI Manager keeps only a hash. Store it in Ansible Vault
            now. If you lose it, revoke the token and mint a new one.
          </p>
          <button
            onClick={() => setSecret(null)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            I have stored the token
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleMint} className="rounded-lg border bg-card p-4 space-y-4" aria-label="Mint token">
          <div>
            <label htmlFor="token-name" className="block text-sm font-medium mb-1">Name *</label>
            <input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              placeholder="e.g. web-fleet or ci-deploy"
              className={inputCls}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Preset</div>
            <div className="flex flex-wrap gap-2">
              {TOKEN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.help}
                  onClick={() => setOps(p.ops)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Allowed operations *</legend>
            {TOKEN_OPS.map(({ op, help }) => (
              <label key={op} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ops.includes(op)}
                  onChange={() => toggleOp(op)}
                  className="mt-1"
                />
                <span>
                  <code className="font-mono text-xs">{op}</code>
                  <span className="block text-xs text-muted-foreground">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="token-host-ca" className="block text-sm font-medium mb-1">
                Host CA{hostNeeded ? ' *' : ''}
              </label>
              <select id="token-host-ca" value={effHostCa} disabled={!hostNeeded} onChange={(e) => setHostCaId(e.target.value)} className={inputCls}>
                <option value="">{!hostNeeded ? 'Not needed' : hostCas.length === 0 ? 'No active Host CA' : 'Choose a Host CA'}</option>
                {hostCas.map((c) => (
                  <option key={c.id} value={c.id}>{caOptionLabel(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="token-user-ca" className="block text-sm font-medium mb-1">
                User CA{userNeeded ? ' *' : ''}
              </label>
              <select id="token-user-ca" value={effUserCa} disabled={!userNeeded} onChange={(e) => setUserCaId(e.target.value)} className={inputCls}>
                <option value="">{!userNeeded ? 'Not needed' : userCas.length === 0 ? 'No active User CA' : 'Choose a User CA'}</option>
                {userCas.map((c) => (
                  <option key={c.id} value={c.id}>{caOptionLabel(c)}</option>
                ))}
              </select>
            </div>
          </div>

          {userNeeded && (
            <fieldset className="space-y-3 rounded-md border p-3" aria-label="sign-user limits">
              <legend className="px-1 text-sm font-medium">sign-user limits</legend>
              <div>
                <div className="text-sm font-medium">Allowed principals</div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  The token can sign only these principals. Leave all unticked to allow any principal (not
                  recommended).
                </p>
                {catalog.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No principals in this zone yet. Create them on the Principals page.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {catalog.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={allowedPrincipals.includes(p.name)}
                          onChange={() => togglePrincipal(p.name)}
                        />
                        <code className="font-mono text-xs">{p.name}</code>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="token-max-lifetime" className="block text-sm font-medium mb-1">
                  Max certificate lifetime
                </label>
                <select
                  id="token-max-lifetime"
                  value={maxLifetime}
                  onChange={(e) => setMaxLifetime(e.target.value)}
                  className={inputCls}
                >
                  {LIFETIME_PRESETS.map((p) => (
                    <option key={p.seconds} value={String(p.seconds)}>{p.label}</option>
                  ))}
                  <option value="">No limit (not recommended)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Certificates this token signs live at most this long. Requests without a lifetime get this value.
                </p>
              </div>
              {noLimits && (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {UNRESTRICTED_WARNING}
                </p>
              )}
            </fieldset>
          )}

          {zoneMismatch && (
            <p role="alert" className="text-sm text-destructive">
              The Host CA and the User CA belong to different zones. A token works in one zone only.
            </p>
          )}
          {name.trim() && problem && ops.length > 0 && <p className="text-sm text-destructive">{problem}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!!problem || zoneMismatch || mintMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
            >
              {mintMutation.isPending ? 'Minting…' : 'Mint token'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {tokensQuery.isLoading && <div className="text-center py-8 text-muted-foreground">Loading…</div>}
      {tokensQuery.isError && (
        <div className="text-center py-8 text-destructive">Error loading fleet tokens: {tokensQuery.error.message}</div>
      )}

      {tokensQuery.isSuccess && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                {isAll && <th className="px-4 py-3 text-left text-sm font-medium">Zone</th>}
                <th className="px-4 py-3 text-left text-sm font-medium">CAs</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Operations</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Limits</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Last used</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={isAll ? 9 : 8} className="px-4 py-8 text-center text-muted-foreground">
                    No fleet tokens yet. Mint one for a host or a CI pipeline.
                  </td>
                </tr>
              ) : (
                tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <KeyRound className="h-4 w-4 text-muted-foreground" />
                        {t.name}
                      </div>
                      <code className="text-xs font-mono text-muted-foreground">{t.tokenPrefix}…</code>
                    </td>
                    {isAll && (
                      <td className="px-4 py-3 text-sm">
                        <code className="text-xs font-mono">{zoneNameById(t.zoneId)}</code>
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs space-y-0.5">
                      {t.hostCaId && <div>Host CA: {caName(t.hostCaId)}</div>}
                      {t.userCaId && <div>User CA: {caName(t.userCaId)}</div>}
                      {!t.hostCaId && !t.userCaId && <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {t.opSet.map((op) => (
                          <code key={op} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{op}</code>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs space-y-0.5">
                      {!t.opSet.includes('sign-user') ? (
                        <span className="text-muted-foreground">—</span>
                      ) : isUnrestrictedSignUser(t) ? (
                        <span
                          title={UNRESTRICTED_HINT}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Unrestricted
                        </span>
                      ) : (
                        <>
                          <div>Principals: {t.allowedPrincipals?.length ? t.allowedPrincipals.join(', ') : 'any'}</div>
                          <div>Max lifetime: {t.maxValidForSeconds != null ? formatLifetime(t.maxValidForSeconds) : 'none'}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : <span className="text-muted-foreground">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          t.revoked
                            ? 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        }`}
                      >
                        {t.revoked ? 'Revoked' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!t.revoked && (
                        <button
                          onClick={() => handleRevoke(t)}
                          disabled={revokeMutation.isPending}
                          className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted text-destructive disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
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

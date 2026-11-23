/**
 * "Allowed principals" for one identity (TASK-245): list, add and remove its
 * grants (ssh_user_principals). Grants are the identity's entitlement catalog:
 * enforced only when a certificate is issued with the entitlement check, and
 * read by the host Access list.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast, useConfirm } from '@/components/ui';

export const GRANTS_EXPLAINER =
  'Principals this identity may receive in its certificates. They are enforced when a certificate is issued with the entitlement check, and they feed the host Access list.';

/** Confirm copy for removing one grant. Exported for tests and the video script. */
export function revokeGrantConfirmCopy(principal: string, subject: string) {
  return {
    title: `Remove grant “${principal}” from ${subject}?`,
    description:
      `New certificates issued with the entitlement check can no longer carry “${principal}”. ` +
      'Certificates already issued keep it until they expire or are revoked.',
    confirmLabel: 'Remove grant',
    tone: 'danger' as const,
  };
}

export function IdentityGrantsSection({ identity }: { identity: { id: string; subject: string; zoneId: string } }) {
  const toast = useToast();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const grantsQuery = trpc.ssh.principal.listGrants.useQuery({ identityId: identity.id });
  // Grants never cross a zone (decision-017 §4): offer only the identity's zone catalog.
  const catalogQuery = trpc.ssh.principal.list.useQuery({ zoneId: identity.zoneId });
  const grantMutation = trpc.ssh.principal.grant.useMutation();
  const revokeMutation = trpc.ssh.principal.revokeGrant.useMutation();
  const [principalId, setPrincipalId] = useState('');

  const grants = grantsQuery.data ?? [];
  const granted = new Set(grants.map((g) => g.principalId));
  const candidates = (catalogQuery.data ?? []).filter((p) => !granted.has(p.id));

  const invalidate = () => {
    utils.ssh.principal.listGrants.invalidate({ identityId: identity.id });
    utils.ssh.host.access.invalidate();
  };

  const handleGrant = () => {
    const p = candidates.find((c) => c.id === principalId);
    if (!p) return;
    grantMutation.mutate(
      { identityId: identity.id, principalId: p.id },
      {
        onSuccess: () => {
          toast.success(`${identity.subject} may now receive “${p.name}”`);
          setPrincipalId('');
          invalidate();
        },
        onError: (e) => toast.error(`Failed to grant: ${e.message}`),
      }
    );
  };

  const handleRevoke = async (g: { principalId: string; name: string }) => {
    const { confirmed } = await confirm(revokeGrantConfirmCopy(g.name, identity.subject));
    if (!confirmed) return;
    revokeMutation.mutate(
      { identityId: identity.id, principalId: g.principalId },
      {
        onSuccess: () => {
          toast.success(`Grant “${g.name}” removed from ${identity.subject}`);
          invalidate();
        },
        onError: (e) => toast.error(`Failed to remove grant: ${e.message}`),
      }
    );
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Allowed principals</h4>
      <p className="text-xs text-muted-foreground">{GRANTS_EXPLAINER}</p>

      {grantsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No principals granted yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Allowed principals">
          {grants.map((g) => (
            <li
              key={g.principalId}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 pl-2.5 pr-1 py-0.5 text-xs font-mono"
              title={g.description ?? undefined}
            >
              {g.name}
              <button
                type="button"
                onClick={() => handleRevoke(g)}
                disabled={revokeMutation.isPending}
                aria-label={`Remove grant ${g.name}`}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={principalId}
          onChange={(e) => setPrincipalId(e.target.value)}
          aria-label="Principal to grant"
          className="px-3 py-1.5 border rounded-md bg-background text-sm"
        >
          <option value="">{candidates.length ? 'Add principal…' : 'No other principals in this zone'}</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleGrant}
          disabled={!principalId || grantMutation.isPending}
          className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
        >
          Grant
        </button>
      </div>
    </div>
  );
}

/**
 * Identity offboarding (TASK-244). Disable only blocks FUTURE issuance; Offboard
 * also revokes every active certificate of the identity (they enter the KRL) and
 * then disables it. The flow is dependency-injected (like block-flows.ts) so the
 * confirm copy and the success/failure handling are unit-testable without tRPC.
 */
import type { ConfirmOptions, ConfirmResult } from '@/components/ui';
import { OffboardDialogBody } from './OffboardDialogBody';

export const OFFBOARD_HINT_COPY = {
  disable:
    'blocks any future certificate issuance for this identity. Already-issued certificates stay valid until they expire or are revoked — this does not touch the KRL.',
  offboard:
    'revokes every active certificate of this identity (they are added to the KRL) and then disables it. Use it when someone leaves. It cannot be undone.',
} as const;

/** "1 active certificate" / "3 active certificates" / "every active certificate" (count unknown). */
export function activeCertsPhrase(count: number | null): string {
  if (count === null) return 'every active certificate';
  return `${count} active certificate${count === 1 ? '' : 's'}`;
}

export interface OffboardFlowDeps {
  subject: string;
  confirm: (opts: ConfirmOptions) => Promise<ConfirmResult>;
  /** Number of active certificates, or throws if it cannot be read. */
  countActiveCerts: () => Promise<number>;
  offboard: (reason: string | undefined) => Promise<unknown>;
  onSuccess: (activeCerts: number | null) => void;
  onError: (message: string) => void;
}

export type OffboardOutcome = 'cancelled' | 'done' | 'failed';

export async function offboardIdentityFlow(deps: OffboardFlowDeps): Promise<OffboardOutcome> {
  let activeCerts: number | null = null;
  try {
    activeCerts = await deps.countActiveCerts();
  } catch {
    activeCerts = null; // the dialog falls back to "every active certificate"
  }
  const { confirmed, reason } = await deps.confirm({
    title: `Offboard ${deps.subject}?`,
    description: <OffboardDialogBody subject={deps.subject} activeCerts={activeCerts} />,
    confirmLabel: 'Offboard',
    tone: 'danger',
    reason: { label: 'Reason (optional, recorded in the audit log)', placeholder: 'e.g. left the company' },
  });
  if (!confirmed) return 'cancelled';
  try {
    await deps.offboard(reason);
  } catch (e) {
    deps.onError(`Failed to offboard identity: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
  deps.onSuccess(activeCerts);
  return 'done';
}

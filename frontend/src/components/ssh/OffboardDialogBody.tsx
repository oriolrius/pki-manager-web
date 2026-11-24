import { activeCertsPhrase } from './offboard-flow';

export function OffboardDialogBody({ subject, activeCerts }: { subject: string; activeCerts: number | null }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        This revokes <strong>{activeCertsPhrase(activeCerts)}</strong> of <strong>{subject}</strong> and{' '}
        <strong>disables the identity</strong>.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Revoked serials are added to the KRL, so hosts that pull the KRL stop accepting them.</li>
        <li>The identity can no longer receive new certificates.</li>
        <li>This cannot be undone.</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        To only block new certificates and keep the current ones valid, use <strong>Disable</strong> instead.
      </p>
    </div>
  );
}

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import {
  SshCapabilityEditor,
  defaultCapabilityValue,
  type SshCapabilityValue,
} from '@/components/SshCapabilityEditor';
import { CertDeliveryPanel } from '@/components/ssh/CertDeliveryPanel';
import { PrincipalReachability } from '@/components/ssh/PrincipalReachability';
import { useToast } from '@/components/ui';
import { useZone } from '@/lib/zone-context';
import { type SshKeyType } from '@/lib/ssh';

export const Route = createFileRoute('/ssh/users/new')({
  component: IssueUserCert,
  validateSearch: (search: Record<string, unknown>): { identityId?: string } => ({
    identityId: typeof search.identityId === 'string' ? search.identityId : undefined,
  }),
});

function IssueUserCert() {
  const toast = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { identityId: initialIdentityId } = Route.useSearch();

  const { zoneId } = useZone();
  const identitiesQuery = trpc.ssh.user.listIdentities.useQuery({ zoneId });
  const [identityId, setIdentityId] = useState(initialIdentityId ?? '');
  // Trust anchors and principals are per-zone; key them off the SELECTED
  // identity's own zone (issuance resolves the CA from the identity's zone).
  const selectedZoneId = (identitiesQuery.data ?? []).find((i) => i.id === identityId)?.zoneId;
  const trustAnchorsQuery = trpc.ssh.ca.trustAnchors.useQuery({ zoneId: selectedZoneId }, { enabled: !!selectedZoneId });
  const principalsQuery = trpc.ssh.principal.list.useQuery({ zoneId: selectedZoneId }, { enabled: !!selectedZoneId });
  const [cap, setCap] = useState<SshCapabilityValue>(defaultCapabilityValue());
  const [result, setResult] = useState<{
    certOpenssh: string;
    serial: string;
    keyType: SshKeyType;
    validBefore: string;
    principals: string[];
  } | null>(null);

  const issueMutation = trpc.ssh.user.issue.useMutation();

  const identities = (identitiesQuery.data ?? []).filter((i) => i.status === 'active');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityId) {
      toast.info('Select an identity.');
      return;
    }
    if (cap.principals.length === 0) {
      toast.info('At least one principal is required.');
      return;
    }
    if (!cap.sshPublicKey.trim()) {
      toast.info('Paste the user public key.');
      return;
    }
    issueMutation.mutate(
      {
        identityId,
        sshPublicKey: cap.sshPublicKey.trim(),
        principals: cap.principals,
        extensions: cap.extensions,
        forceCommand: cap.forceCommand.trim() || undefined,
        sourceAddress: cap.sourceAddress.trim() || undefined,
        validForSeconds: cap.validForSeconds,
      },
      {
        onSuccess: (res) => {
          utils.ssh.user.listCertificates.invalidate();
          setResult({
            certOpenssh: res.cert.certOpenssh,
            serial: res.cert.serial,
            keyType: res.keyType,
            validBefore: res.cert.validBefore,
            principals: cap.principals,
          });
        },
        onError: (err) => toast.error(`Failed to issue certificate: ${err.message}`),
      }
    );
  };

  if (result) {
    const expires = new Date(result.validBefore);

    return (
      <div className="space-y-6 max-w-3xl">
        <button
          onClick={() => navigate({ to: '/ssh/users' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </button>
        <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-800 text-green-900 dark:text-green-200 text-sm">
          Certificate issued (serial {result.serial}). It grants principals{' '}
          <strong>{result.principals.join(', ') || '—'}</strong> and <strong>expires {expires.toLocaleString()}</strong>{' '}
          (≈1 week — re-issue then, no new key needed). This certificate can log in only where one of its principals is
          mapped to a local account. Deliver the blocks below to the user out-of-band.
        </div>
        <CertDeliveryPanel
          certOpenssh={result.certOpenssh}
          keyType={result.keyType}
          hostCaKeys={trustAnchorsQuery.data?.hostCaKeys ?? []}
        />
        <button
          onClick={() => {
            setResult(null);
            setCap(defaultCapabilityValue());
          }}
          className="px-4 py-2 border rounded-md hover:bg-muted font-medium"
        >
          Issue another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <button
        onClick={() => navigate({ to: '/ssh/users' })}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Users
      </button>

      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold">Issue User Certificate</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign a user's SSH public key with the User CA, granting the selected principals and capabilities.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Identity *</label>
            <select
              value={identityId}
              onChange={(e) => setIdentityId(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="">Select an identity…</option>
              {identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.subject}
                  {i.email ? ` (${i.email})` : ''}
                </option>
              ))}
            </select>
            {identities.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                No active identities. Create one on the Users page first.
              </p>
            )}
          </div>

          <SshCapabilityEditor value={cap} onChange={setCap} principalCatalog={principalsQuery.data ?? []} />

          <PrincipalReachability principals={cap.principals} zoneId={selectedZoneId} />

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={() => navigate({ to: '/ssh/users' })}
              className="px-6 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issueMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium shadow-sm"
            >
              {issueMutation.isPending ? 'Issuing...' : 'Issue Certificate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

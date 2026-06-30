import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import {
  SshCapabilityEditor,
  defaultCapabilityValue,
  type SshCapabilityValue,
} from '@/components/SshCapabilityEditor';
import { DeployPanel } from '@/components/DeployPanel';
import { ConfigSnippet } from '@/components/ConfigSnippet';

export const Route = createFileRoute('/ssh/users/new')({
  component: IssueUserCert,
  validateSearch: (search: Record<string, unknown>): { identityId?: string } => ({
    identityId: typeof search.identityId === 'string' ? search.identityId : undefined,
  }),
});

function IssueUserCert() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { identityId: initialIdentityId } = Route.useSearch();

  const identitiesQuery = trpc.ssh.user.listIdentities.useQuery();
  const [identityId, setIdentityId] = useState(initialIdentityId ?? '');
  const [cap, setCap] = useState<SshCapabilityValue>(defaultCapabilityValue());
  const [result, setResult] = useState<{ certOpenssh: string; sshClientConfig: string; serial: string } | null>(null);

  const issueMutation = trpc.ssh.user.issue.useMutation();

  const identities = (identitiesQuery.data ?? []).filter((i) => i.status === 'active');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityId) {
      alert('Select an identity.');
      return;
    }
    if (cap.principals.length === 0) {
      alert('At least one principal is required.');
      return;
    }
    if (!cap.sshPublicKey.trim()) {
      alert('Paste the user public key.');
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
            sshClientConfig: res.sshClientConfig,
            serial: res.cert.serial,
          });
        },
        onError: (err) => alert(`Failed to issue certificate: ${err.message}`),
      }
    );
  };

  if (result) {
    return (
      <div className="space-y-6 max-w-3xl">
        <button
          onClick={() => navigate({ to: '/ssh/users' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </button>
        <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-800 text-sm">
          Certificate issued (serial {result.serial}). Deliver the certificate to the user.
        </div>
        <DeployPanel title="Issued certificate" description="Save and distribute to the user.">
          <ConfigSnippet
            title="SSH certificate"
            description="Save next to the user's key as <key>-cert.pub."
            content={result.certOpenssh}
            downloadFilename="id_ecdsa-cert.pub"
            badge="cert"
          />
          <ConfigSnippet
            title="ssh client config"
            description="Optional ~/.ssh/config helper."
            content={result.sshClientConfig}
            downloadFilename="ssh_config"
          />
        </DeployPanel>
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

          <SshCapabilityEditor value={cap} onChange={setCap} />

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


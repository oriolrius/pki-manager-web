import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, RotateCw, Archive, XCircle } from 'lucide-react';
import { useState } from 'react';
import { DeployPanel } from '@/components/DeployPanel';
import { ConfigSnippet } from '@/components/ConfigSnippet';
import { Callout } from '@/components/ssh/Callout';
import { useToast, useConfirm } from '@/components/ui';

export const Route = createFileRoute('/ssh/cas/$id')({
  component: SshCaDetail,
});

function SshCaDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const toast = useToast();
  const confirm = useConfirm();

  const caQuery = trpc.ssh.ca.get.useQuery({ id });
  const listQuery = trpc.ssh.ca.list.useQuery();
  const [knownHostsPattern, setKnownHostsPattern] = useState('*.example.com');

  const rotateMutation = trpc.ssh.ca.rotate.useMutation();
  const retireMutation = trpc.ssh.ca.retire.useMutation();
  const revokeMutation = trpc.ssh.ca.revoke.useMutation();

  const invalidate = () => {
    utils.ssh.ca.list.invalidate();
    utils.ssh.ca.get.invalidate({ id });
    utils.ssh.ca.trustAnchors.invalidate();
  };

  if (caQuery.isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading SSH CA...</div>;
  }
  if (caQuery.isError || !caQuery.data) {
    return <div className="text-center py-8 text-destructive">SSH CA not found</div>;
  }

  const ca = caQuery.data;
  // During rotation, the predecessor (this CA) and its successor are both trusted.
  const successor = listQuery.data?.find((c) => c.predecessorCaId === ca.id);
  const isRotating = ca.status === 'rotating' || !!successor;

  const handleRotate = async () => {
    const { confirmed } = await confirm({
      title: 'Rotate this CA?',
      description: 'A successor key is generated; the current key stays trusted during overlap.',
      confirmLabel: 'Rotate',
      tone: 'danger',
    });
    if (!confirmed) return;
    rotateMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast.success('CA rotated. Both keys are published as trust anchors during the overlap.');
        },
        onError: (e) => toast.error(`Rotate failed: ${e.message}`),
      }
    );
  };

  const handleRetire = async () => {
    const { confirmed } = await confirm({
      title: 'Retire this CA?',
      description: 'It will no longer be published as a trust anchor.',
      confirmLabel: 'Retire',
      tone: 'danger',
    });
    if (!confirmed) return;
    retireMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast.success('CA retired.');
        },
        onError: (e) => toast.error(`Retire failed: ${e.message}`),
      }
    );
  };

  const handleRevoke = async () => {
    const { confirmed, reason } = await confirm({
      title: 'Revoke this CA?',
      description: 'This is irreversible.',
      confirmLabel: 'Revoke',
      tone: 'danger',
      reason: { label: 'Reason (optional)', placeholder: 'Why is this CA being revoked?' },
    });
    if (!confirmed) return;
    revokeMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          invalidate();
          toast.success('CA revoked.');
        },
        onError: (e) => toast.error(`Revoke failed: ${e.message}`),
      }
    );
  };

  const isUserCa = ca.caType === 'user';
  const certAuthorityLine = `@cert-authority ${knownHostsPattern} ${ca.opensshPublicKey}`;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate({ to: '/ssh/cas' })}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to SSH CAs
      </button>

      {/* Header */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{ca.label || (isUserCa ? 'User CA' : 'Host CA')}</h1>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  isUserCa
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                }`}
              >
                {isUserCa ? 'User CA' : 'Host CA'}
              </span>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  ca.status === 'active'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : ca.status === 'rotating'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                }`}
              >
                {ca.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground font-mono">{ca.fingerprintSha256}</p>
            <p className="text-xs text-muted-foreground">
              {ca.keyAlgorithm} · created {new Date(ca.createdAt).toLocaleString()} · next serial {ca.nextSerial}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRotate}
              disabled={rotateMutation.isPending || ca.status !== 'active'}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm disabled:opacity-50"
            >
              <RotateCw className="h-4 w-4" />
              Rotate
            </button>
            <button
              onClick={handleRetire}
              disabled={retireMutation.isPending || ca.status === 'retired'}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              Retire
            </button>
            <button
              onClick={handleRevoke}
              disabled={revokeMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm text-destructive disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Revoke
            </button>
          </div>
        </div>
      </div>

      {isRotating && successor && (
        <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 text-yellow-900 dark:text-yellow-200 text-sm">
          This CA is rotating. Both the current key and its successor are published as trust anchors during the overlap —
          deploy <strong>both</strong> keys below.
        </div>
      )}

      <Callout title={isUserCa ? 'User CA → trusted BY servers' : 'Host CA → trusted BY clients'}>
        {isUserCa ? (
          <>
            This CA signs <strong>people's login certificates</strong>. Install its public key on every server as{' '}
            <code className="font-mono">/etc/ssh/ssh-user-ca.pub</code> (TrustedUserCAKeys) so the server trusts logins.
          </>
        ) : (
          <>
            This CA signs <strong>servers' host certificates</strong>. Add its{' '}
            <code className="font-mono">@cert-authority</code> line to clients' <code className="font-mono">known_hosts</code>{' '}
            so clients trust hosts (no more "authenticity can't be established" prompts).
          </>
        )}
      </Callout>

      {/* Deploy panel */}
      <DeployPanel
        title="Deploy"
        description={
          isUserCa
            ? 'Distribute the User CA public key so hosts trust certificates it signs.'
            : 'Distribute the Host CA public key so clients trust host certificates it signs.'
        }
      >
        <ConfigSnippet
          title="OpenSSH public key (this CA)"
          content={ca.opensshPublicKey}
          downloadFilename={`ssh_${ca.caType}_ca.pub`}
          badge=".pub"
        />

        {successor && (
          <ConfigSnippet
            title="OpenSSH public key (successor)"
            description="Published during rotation overlap."
            content={successor.opensshPublicKey}
            downloadFilename={`ssh_${ca.caType}_ca_successor.pub`}
            badge=".pub"
          />
        )}

        {isUserCa ? (
          <ConfigSnippet
            title="TrustedUserCAKeys (server sshd_config)"
            description="Place on each server at /etc/ssh/ssh-user-ca.pub and reference it from sshd_config."
            content={
              [ca.opensshPublicKey, successor?.opensshPublicKey].filter(Boolean).join('\n') +
              '\n\n# sshd_config:\n# TrustedUserCAKeys /etc/ssh/ssh-user-ca.pub'
            }
            downloadFilename="ssh-user-ca.pub"
          />
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium">known_hosts @cert-authority line</label>
            <p className="text-xs text-muted-foreground">
              Add to clients' <code className="font-mono">~/.ssh/known_hosts</code> (or system-wide). Edit the host
              pattern to match your fleet.
            </p>
            <input
              type="text"
              value={knownHostsPattern}
              onChange={(e) => setKnownHostsPattern(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
              aria-label="known_hosts host pattern"
            />
            <ConfigSnippet content={certAuthorityLine} downloadFilename="known_hosts_cert_authority" />
            {successor && (
              <ConfigSnippet
                title="Successor @cert-authority"
                content={`@cert-authority ${knownHostsPattern} ${successor.opensshPublicKey}`}
              />
            )}
          </div>
        )}
      </DeployPanel>
    </div>
  );
}

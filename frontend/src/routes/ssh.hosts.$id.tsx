import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, RefreshCw, XCircle, LogOut } from 'lucide-react';
import { DeployPanel } from '@/components/DeployPanel';
import { ConfigSnippet } from '@/components/ConfigSnippet';
import { HostAccessCard } from '@/components/ssh/HostAccessCard';
import { useToast, useConfirm } from '@/components/ui';
import type { CodeLanguage } from '@/lib/highlight';

/** Pick syntax highlighting for a host deploy file by its name/filename. */
function fileLanguage(f: { name: string; filename: string; isAuthPrincipals?: boolean }): CodeLanguage | undefined {
  if (f.isAuthPrincipals) return undefined; // plain list of usernames
  if (f.filename.endsWith('.pub')) return 'blob'; // host cert / CA public keys
  if (/sshd|drop-in|config/i.test(f.name)) return 'ssh_config';
  return undefined;
}

export const Route = createFileRoute('/ssh/hosts/$id')({
  component: SshHostDetail,
});

function SshHostDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const toast = useToast();
  const confirm = useConfirm();

  const hostQuery = trpc.ssh.host.get.useQuery({ id });
  const bundleQuery = trpc.ssh.host.deployBundle.useQuery({ id });

  const issueMutation = trpc.ssh.host.issue.useMutation();
  const revokeMutation = trpc.ssh.host.revoke.useMutation();
  const offboardMutation = trpc.ssh.host.offboard.useMutation();
  const markPushedMutation = trpc.ssh.principal.markPushed.useMutation();

  const invalidate = () => {
    utils.ssh.host.get.invalidate({ id });
    utils.ssh.host.list.invalidate();
    utils.ssh.host.deployBundle.invalidate({ id });
  };

  const handleMarkPushed = () => {
    markPushedMutation.mutate(
      { hostId: id },
      { onSuccess: () => utils.ssh.host.deployBundle.invalidate({ id }) }
    );
  };

  if (hostQuery.isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading host...</div>;
  }
  if (hostQuery.isError || !hostQuery.data) {
    return <div className="text-center py-8 text-destructive">Host not found</div>;
  }

  const host = hostQuery.data;
  const bundle = bundleQuery.data;

  const handleRenew = async () => {
    const { confirmed } = await confirm({
      title: 'Issue/renew the host certificate now?',
      confirmLabel: 'Issue',
    });
    if (!confirmed) return;
    issueMutation.mutate(
      { hostId: id },
      {
        onSuccess: () => {
          invalidate();
          toast.success('Host certificate issued.');
        },
        onError: (e) => toast.error(`Issue failed: ${e.message}`),
      }
    );
  };

  const handleRevoke = async () => {
    const { confirmed, reason } = await confirm({
      title: 'Revoke the current host certificate?',
      confirmLabel: 'Revoke',
      tone: 'danger',
      reason: { label: 'Reason (optional)', placeholder: 'Why is this certificate being revoked?' },
    });
    if (!confirmed) return;
    revokeMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          invalidate();
          toast.success('Certificate revoked. Regenerate the KRL to distribute.');
        },
        onError: (e) => toast.error(`Revoke failed: ${e.message}`),
      }
    );
  };

  const handleOffboard = async () => {
    const { confirmed, reason } = await confirm({
      title: 'Offboard this host?',
      description: 'This revokes the cert and disables issuance. This is a terminal state.',
      confirmLabel: 'Offboard',
      tone: 'danger',
      reason: { label: 'Reason (optional)', placeholder: 'Why is this host being offboarded?' },
    });
    if (!confirmed) return;
    offboardMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          invalidate();
          toast.success('Host offboarded.');
        },
        onError: (e) => toast.error(`Offboard failed: ${e.message}`),
      }
    );
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate({ to: '/ssh/hosts' })}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Hosts
      </button>

      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{host.fqdn}</h1>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  host.status === 'active'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : host.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                }`}
              >
                {host.status}
              </span>
            </div>
            {host.displayName && <p className="text-sm text-muted-foreground">{host.displayName}</p>}
            <p className="text-xs text-muted-foreground font-mono">
              {host.addresses.length ? host.addresses.join(', ') : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {host.hasPubkey ? 'Public key registered' : 'No public key'} ·{' '}
              {host.currentCertId ? 'has active certificate' : 'no active certificate'}
              {host.lastKrlVersion ? ` · last KRL ${host.lastKrlVersion}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRenew}
              disabled={issueMutation.isPending || host.status === 'offboarded'}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {host.currentCertId ? 'Renew' : 'Issue'}
            </button>
            <button
              onClick={handleRevoke}
              disabled={revokeMutation.isPending || !host.currentCertId}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm text-destructive disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Revoke
            </button>
            <button
              onClick={handleOffboard}
              disabled={offboardMutation.isPending || host.status === 'offboarded'}
              className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-muted text-sm text-destructive disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              Offboard
            </button>
          </div>
        </div>
      </div>

      {/* Per-host user access blocks (decision-016) — between header and deploy panel. */}
      {host.status !== 'offboarded' && <HostAccessCard hostId={id} />}

      {bundle && (
        <DeployPanel
          title="Files to place on this server"
          description="Everything this host needs, in one place. Place each file at the path shown, then validate and reload sshd. Nothing is pushed automatically."
        >
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-3 text-xs">
            {bundle.prerequisites}
          </div>

          {bundle.principalsStale && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 p-2.5 text-xs">
              <span>
                Principal maps changed since the last push — re-deploy the <code className="font-mono">auth_principals</code>{' '}
                files below, then mark them pushed.
              </span>
              <button
                onClick={handleMarkPushed}
                disabled={markPushedMutation.isPending}
                className="px-2 py-1 rounded border border-amber-400 dark:border-amber-700 bg-amber-100/60 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100 hover:bg-amber-200/70 dark:hover:bg-amber-700/50 disabled:opacity-50 whitespace-nowrap"
              >
                Mark pushed
              </button>
            </div>
          )}

          {!bundle.hasCert && (
            <p className="text-sm text-muted-foreground">
              No certificate yet — use the <strong>Issue</strong> button above; the host certificate will then appear
              here.
            </p>
          )}

          {bundle.files.map((f, i) => (
            <ConfigSnippet
              key={f.path}
              title={`${i + 1}. ${f.name}`}
              description={`→ ${f.path}  ·  mode ${f.mode}${
                f.isAuthPrincipals && bundle.principalsStale ? '  ·  needs push' : ''
              }`}
              content={f.content}
              downloadFilename={f.filename}
              badge={f.mode}
              language={fileLanguage(f)}
            />
          ))}

          {bundle.krl && (
            <ConfigSnippet
              title="Revocation (RevokedKeys)"
              description="sshd needs this file to exist (fail-closed). Live revocation and per-host blocks land via the signed ECIES krl-client channel — set it up with the Ansible role, not a raw KRL fetch."
              content={bundle.krl.setup}
              badge="shell"
              language="shell"
            />
          )}

          <ConfigSnippet
            title="Validate &amp; reload sshd"
            description="Run after placing the files. Reload (not restart) — OpenSSH re-reads the cert, trust anchors, and KRL per authentication."
            content={bundle.reloadCommands}
            badge="shell"
            language="shell"
          />
        </DeployPanel>
      )}
    </div>
  );
}

/**
 * Principal-to-local-account mapping for one host: the map form, the rendered
 * /etc/ssh/auth_principals/<account> files, and the stale / Mark pushed signal.
 * Shared by the Principals page (host picker) and the host detail page.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ConfigSnippet } from '@/components/ConfigSnippet';
import { useToast } from '@/components/ui';

export interface HostPrincipalMappingCardProps {
  hostId: string;
  /** Card heading. Use the host's FQDN on the Principals page; a static label on the host page. */
  title: string;
  /** Shown under the heading (e.g. the host FQDN when the title is a static label). */
  subtitle?: string;
}

export function HostPrincipalMappingCard({ hostId, title, subtitle }: HostPrincipalMappingCardProps) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const principalsQuery = trpc.ssh.principal.list.useQuery();
  const staleQuery = trpc.ssh.principal.staleHosts.useQuery();
  const renderQuery = trpc.ssh.principal.render.useQuery({ hostId });

  const [principalId, setPrincipalId] = useState('');
  const [localAccount, setLocalAccount] = useState('');

  const mapMutation = trpc.ssh.principal.map.useMutation();
  const markPushedMutation = trpc.ssh.principal.markPushed.useMutation();

  const principals = principalsQuery.data ?? [];
  const stale = (staleQuery.data ?? []).some((h) => h.id === hostId);
  const render = renderQuery.data;

  const invalidate = () => {
    utils.ssh.principal.render.invalidate({ hostId });
    utils.ssh.principal.staleHosts.invalidate();
    utils.ssh.principal.mappingsByPrincipal.invalidate();
    utils.ssh.host.deployBundle.invalidate({ id: hostId });
  };

  const handleMap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!principalId || !localAccount.trim()) return;
    mapMutation.mutate(
      { hostId, principalId, localAccount: localAccount.trim() },
      {
        onSuccess: () => {
          toast.success(`Mapped to “${localAccount.trim()}” on this host`);
          invalidate();
          setLocalAccount('');
          setPrincipalId('');
        },
        onError: (err) => toast.error(`Failed: ${err.message}`),
      }
    );
  };

  const handleMarkPushed = () => {
    markPushedMutation.mutate(
      { hostId },
      {
        onSuccess: () => {
          toast.success('Marked as pushed on this host');
          invalidate();
        },
        onError: (err) => toast.error(`Failed: ${err.message}`),
      }
    );
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 p-4 border-b">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold truncate">{title}</h2>
            {stale && <StalePill />}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground truncate">{subtitle}</p>}
        </div>
        {stale && (
          <button
            onClick={handleMarkPushed}
            disabled={markPushedMutation.isPending}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50 whitespace-nowrap"
          >
            Mark pushed
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <form onSubmit={handleMap} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="block text-sm font-medium mb-1">Principal</label>
            <select
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
              aria-label="Principal"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            >
              <option value="">Select…</option>
              {principals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-sm font-medium mb-1">Local account</label>
            <input
              type="text"
              value={localAccount}
              onChange={(e) => setLocalAccount(e.target.value)}
              placeholder="root"
              aria-label="Local account"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={mapMutation.isPending || !principalId || !localAccount.trim()}
            className="px-4 py-2 border rounded-md hover:bg-muted text-sm disabled:opacity-50"
          >
            Map
          </button>
        </form>

        {principals.length === 0 && !principalsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">
            No principals defined yet — create one in the principal catalog first.
          </p>
        )}

        {renderQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading mapping...</p>
        ) : render && Object.keys(render.files).length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-mono">{render.directive}</p>
            {Object.entries(render.files).map(([account, contents]) => (
              <ConfigSnippet
                key={account}
                title={`/etc/ssh/auth_principals/${account}`}
                content={contents}
                downloadFilename={account}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No principal mappings for this host yet.</p>
        )}
      </div>
    </div>
  );
}

/** The "this host's auth_principals files are out of date" signal, shared with the host picker list. */
export function StalePill() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
      <AlertTriangle className="h-3 w-3" />
      Stale — needs push
    </span>
  );
}

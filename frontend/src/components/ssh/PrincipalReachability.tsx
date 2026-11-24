import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * Shows where each chosen principal currently grants login, and warns when one
 * is mapped to no host account — the cert would authenticate but be denied login
 * everywhere (the most common SSH-cert mistake). Scoped to the selected
 * identity's zone (TASK-249): a cert logs in only to hosts of its own zone, and
 * principal names repeat across zones.
 */
export function PrincipalReachability({ principals, zoneId }: { principals: string[]; zoneId?: string }) {
  const q = trpc.ssh.principal.mappingsByPrincipal.useQuery({ zone: zoneId }, { enabled: !!zoneId });
  if (principals.length === 0 || !zoneId) return null;
  const map = q.data ?? {};
  const anyUnmapped = principals.some((p) => !(map[p]?.length));

  return (
    <div className="rounded-md border p-3 text-xs space-y-1.5">
      <div className="font-medium">Where these principals grant login</div>
      {principals.map((p) => {
        const targets = map[p] ?? [];
        return (
          <div key={p} className="flex items-start gap-2">
            {targets.length ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            )}
            <code className="font-mono">{p}</code>
            {targets.length ? (
              <span className="text-muted-foreground">
                → {targets.map((t) => `${t.fqdn} (${t.localAccount})`).join(', ')}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                → not mapped to any host account. A certificate with only this principal cannot log in anywhere — map it
                first.
              </span>
            )}
          </div>
        );
      })}
      {anyUnmapped && (
        <Link to="/ssh/principals" className="inline-flex items-center gap-1 text-primary hover:underline pt-1">
          Map principals to host accounts →
        </Link>
      )}
    </div>
  );
}


import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { RefreshCw, Ban } from 'lucide-react';
import { Callout } from '@/components/ssh/Callout';
import { HostKrlStatePill } from '@/components/ssh/HostKrlStatePill';

export const Route = createFileRoute('/ssh/krl')({
  component: SshKrl,
});

function SshKrl() {
  const casQuery = trpc.ssh.ca.list.useQuery();
  const cas = (casQuery.data ?? []).filter((c) => c.status !== 'retired');
  const [selectedCaId, setSelectedCaId] = useState<string>('');

  const effectiveCaId = selectedCaId || cas[0]?.id || '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Key Revocation Lists (KRL)</h2>
        <select
          value={effectiveCaId}
          onChange={(e) => setSelectedCaId(e.target.value)}
          className="px-3 py-2 border rounded-md bg-background text-sm"
        >
          {cas.length === 0 && <option value="">No CAs</option>}
          {cas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label || (c.caType === 'user' ? 'User CA' : 'Host CA')} ({c.caType})
            </option>
          ))}
        </select>
      </div>

      <Callout tone="warn" title="Generating a KRL does not deploy it">
        <strong>Generate KRL</strong> and <strong>Mark pushed</strong> only update PKI Manager — nothing is pushed to
        your servers. A server's <code className="font-mono">RevokedKeys</code> gates user logins, so each server fetches
        the <strong>User CA's</strong> <code className="font-mono">/krl/&lt;userCaId&gt;.bin</code> into{' '}
        <code className="font-mono">/etc/ssh/revoked_keys</code> (the per-host deploy panel includes a ready cron
        snippet). Short certificate lifetimes are the primary revocation; the KRL is the emergency kill switch.
      </Callout>

      {effectiveCaId ? <KrlForCa caId={effectiveCaId} /> : <p className="text-muted-foreground">Create a CA first.</p>}

      <HostDistribution />
    </div>
  );
}

function KrlForCa({ caId }: { caId: string }) {
  const utils = trpc.useUtils();
  const latestQuery = trpc.ssh.krl.getLatest.useQuery({ id: caId });
  const revocationsQuery = trpc.ssh.krl.listRevocations.useQuery({ id: caId });

  const generateMutation = trpc.ssh.krl.generate.useMutation();
  const revokeSerialMutation = trpc.ssh.krl.revokeSerial.useMutation();
  const revokeKeyMutation = trpc.ssh.krl.revokeKey.useMutation();
  const revokeCertMutation = trpc.ssh.krl.revokeCert.useMutation();

  const [mode, setMode] = useState<'serial' | 'key' | 'cert'>('serial');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const latest = latestQuery.data;
  const revocations = revocationsQuery.data ?? [];

  const invalidate = () => {
    utils.ssh.krl.getLatest.invalidate({ id: caId });
    utils.ssh.krl.listRevocations.invalidate({ id: caId });
  };

  const handleGenerate = () => {
    generateMutation.mutate(
      { id: caId },
      {
        onSuccess: () => {
          invalidate();
          alert('KRL generated.');
        },
        onError: (e) => alert(`Generate failed: ${e.message}`),
      }
    );
  };

  const handleRevoke = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    const onSuccess = () => {
      invalidate();
      setValue('');
      setReason('');
      alert('Revoked. Regenerate the KRL to publish.');
    };
    const onError = (err: { message: string }) => alert(`Revoke failed: ${err.message}`);
    const r = reason.trim() || undefined;
    if (mode === 'serial') revokeSerialMutation.mutate({ caId, serial: v, reason: r }, { onSuccess, onError });
    else if (mode === 'key') revokeKeyMutation.mutate({ caId, fingerprint: v, reason: r }, { onSuccess, onError });
    else revokeCertMutation.mutate({ certId: v, reason: r }, { onSuccess, onError });
  };

  return (
    <div className="space-y-4">
      {/* KRL status */}
      <div className="rounded-lg border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">KRL version</div>
            <div className="font-mono font-medium">{latest ? `#${latest.krlNumber}` : '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Revoked entries</div>
            <div className="font-medium">{latest ? latest.revokedCount : 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Next update</div>
            <div className="text-xs">{latest ? new Date(latest.nextUpdate).toLocaleString() : '—'}</div>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generateMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium"
        >
          <RefreshCw className="h-4 w-4" />
          Generate KRL
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        This CA's KRL is published at <code className="font-mono">/krl/{caId}.bin</code>. Servers fetch the{' '}
        <strong>User CA's</strong> KRL into <code className="font-mono">/etc/ssh/revoked_keys</code> to reject revoked
        user logins.
      </p>

      {/* Revoke form */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Ban className="h-4 w-4 text-destructive" />
          Revoke
        </h3>
        <div className="flex gap-1">
          {(['serial', 'key', 'cert'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm rounded-md border ${
                mode === m ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}
            >
              By {m}
            </button>
          ))}
        </div>
        <form onSubmit={handleRevoke} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">
              {mode === 'serial' ? 'Serial' : mode === 'key' ? 'Key fingerprint' : 'Certificate ID'}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                mode === 'serial' ? '12345' : mode === 'key' ? 'SHA256:…' : 'cert id'
              }
              className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="key compromise"
              className="w-full px-3 py-2 border rounded-md bg-background text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!value.trim()}
            className="px-4 py-2 border rounded-md hover:bg-muted text-sm text-destructive disabled:opacity-50"
          >
            Revoke
          </button>
        </form>
      </div>

      {/* Revocation list */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Target</th>
              <th className="px-3 py-2 text-left font-medium">Value</th>
              <th className="px-3 py-2 text-left font-medium">Reason</th>
              <th className="px-3 py-2 text-left font-medium">Revoked at</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {revocations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No revocations for this CA.
                </td>
              </tr>
            ) : (
              revocations.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{r.targetType}</td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{r.serial ?? r.keyFingerprint ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.reason || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.revokedAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HostDistribution() {
  // BLK-09: the fleet-wide propagation view — per-host blocks + distribution state.
  const fleetQuery = trpc.ssh.block.fleetDistribution.useQuery();
  const rows = (fleetQuery.data ?? []).filter((h) => h.status === 'active');

  return (
    <div className="space-y-2">
      <h3 className="font-medium">KRL distribution (per host)</h3>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Host</th>
              <th className="px-3 py-2 text-left font-medium">Blocks</th>
              <th className="px-3 py-2 text-left font-medium">State</th>
              <th className="px-3 py-2 text-left font-medium">Last KRL version</th>
              <th className="px-3 py-2 text-left font-medium">Last fetch</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No active hosts.
                </td>
              </tr>
            ) : (
              rows.map((h) => (
                <tr key={h.hostId}>
                  <td className="px-3 py-2 font-medium">{h.fqdn}</td>
                  <td className="px-3 py-2">{h.blockCount || '—'}</td>
                  <td className="px-3 py-2">
                    <HostKrlStatePill state={h.state} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{h.lastKrlVersion ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {h.lastKrlFetchAt ? new Date(h.lastKrlFetchAt).toLocaleString() : 'never'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

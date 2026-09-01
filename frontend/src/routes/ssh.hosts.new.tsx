import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { TagInput } from '@/components/TagInput';
import { useToast } from '@/components/ui';
import { ZonePicker } from '@/components/ssh/ZonePicker';

export const Route = createFileRoute('/ssh/hosts/new')({
  component: NewSshHost,
});

function NewSshHost() {
  const toast = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [fqdn, setFqdn] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [addresses, setAddresses] = useState<string[]>([]);
  const [opensshHostPubkey, setOpensshHostPubkey] = useState('');
  const [zone, setZone] = useState('');
  const [issueNow, setIssueNow] = useState(true);

  const registerMutation = trpc.ssh.host.register.useMutation();
  const issueMutation = trpc.ssh.host.issue.useMutation();

  const pending = registerMutation.isPending || issueMutation.isPending;

  // Host keys must be ecdsa-sha2-nistp256: the one key is both the certificate
  // subject and the ECIES recipient for encrypted KRL distribution.
  const keyText = opensshHostPubkey.trim();
  const keyIsEcdsa = keyText.startsWith('ecdsa-sha2-nistp256 ');
  const keyTypeWrong = keyText.length > 0 && !keyIsEcdsa;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zone) {
      toast.error('Pick a zone for the host');
      return;
    }
    try {
      const host = await registerMutation.mutateAsync({
        fqdn: fqdn.trim(),
        displayName: displayName.trim() || undefined,
        addresses,
        opensshHostPubkey: opensshHostPubkey.trim(),
        zone,
      });
      if (issueNow) {
        await issueMutation.mutateAsync({ hostId: host.id });
      }
      utils.ssh.host.list.invalidate();
      navigate({ to: '/ssh/hosts/$id', params: { id: host.id } });
    } catch (error: any) {
      toast.error(`Failed: ${error.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <button
        onClick={() => navigate({ to: '/ssh/hosts' })}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Hosts
      </button>

      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold">Register SSH Host</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register a host's public key, then issue a host certificate signed by the Host CA.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Zone *</label>
            <ZonePicker value={zone} onChange={setZone} />
            <p className="text-xs text-muted-foreground mt-1">
              The host is enrolled in this zone and trusts only its zone's user CAs.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">FQDN *</label>
            <input
              type="text"
              value={fqdn}
              onChange={(e) => setFqdn(e.target.value)}
              required
              placeholder="web01.example.com"
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Display name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={128}
              placeholder="Web Server 01"
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>

          <TagInput
            label="Addresses / SAN principals"
            tags={addresses}
            onChange={setAddresses}
            placeholder="web01.example.com, 10.0.0.5 (press Enter)"
            help="Hostnames / IPs the certificate should be valid for. Defaults to the FQDN if left empty."
          />

          <div>
            <label className="block text-sm font-medium mb-2">Host public key *</label>
            <textarea
              value={opensshHostPubkey}
              onChange={(e) => setOpensshHostPubkey(e.target.value)}
              required
              rows={3}
              placeholder="ecdsa-sha2-nistp256 AAAA... root@web01"
              className={`w-full px-3 py-2 border rounded-md bg-background text-xs font-mono ${
                keyTypeWrong ? 'border-red-400 dark:border-red-700' : ''
              }`}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paste <code className="font-mono">/etc/ssh/ssh_host_ecdsa_key.pub</code> from the host. Host keys must be{' '}
              <code className="font-mono">ecdsa-sha2-nistp256</code> — the same key is the certificate subject and the
              ECIES recipient for encrypted KRL (revocation) distribution, which requires a P-256 key.
            </p>
            {keyTypeWrong && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                This is not an <code className="font-mono">ecdsa-sha2-nistp256</code> key. Generate/point at the host's
                ECDSA key: <code className="font-mono">ssh-keygen -t ecdsa -b 256 -f /etc/ssh/ssh_host_ecdsa_key</code>.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} className="h-4 w-4" />
            Issue a host certificate immediately after registering
          </label>

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={() => navigate({ to: '/ssh/hosts' })}
              className="px-6 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || keyTypeWrong || !zone}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium shadow-sm"
            >
              {pending ? 'Working...' : issueNow ? 'Register & Issue' : 'Register Host'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

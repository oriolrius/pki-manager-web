import { ShieldAlert } from 'lucide-react';
import { TagInput } from './TagInput';

export type SshExtension =
  | 'permit-X11-forwarding'
  | 'permit-agent-forwarding'
  | 'permit-port-forwarding'
  | 'permit-pty'
  | 'permit-user-rc';

export const ALL_SSH_EXTENSIONS: SshExtension[] = [
  'permit-X11-forwarding',
  'permit-agent-forwarding',
  'permit-port-forwarding',
  'permit-pty',
  'permit-user-rc',
];

export const TTL_PRESETS = [
  { label: '+1h', seconds: 3600 },
  { label: '+1d', seconds: 24 * 3600 },
  { label: '+1w', seconds: 7 * 24 * 3600 },
  { label: '+1m', seconds: 30 * 24 * 3600 },
  { label: '+3m', seconds: 90 * 24 * 3600 },
  { label: '+6m', seconds: 180 * 24 * 3600 },
  { label: '+1y', seconds: 365 * 24 * 3600 },
  { label: '+5y', seconds: 5 * 365 * 24 * 3600 },
  { label: '+10y', seconds: 10 * 365 * 24 * 3600 },
];

export interface SshCapabilityValue {
  principals: string[];
  extensions: SshExtension[];
  forceCommand: string;
  sourceAddress: string;
  validForSeconds: number;
  sshPublicKey: string;
}

export const defaultCapabilityValue = (): SshCapabilityValue => ({
  principals: [],
  extensions: [...ALL_SSH_EXTENSIONS],
  forceCommand: '',
  sourceAddress: '',
  validForSeconds: 7 * 24 * 3600,
  sshPublicKey: '',
});

export interface SshCapabilityEditorProps {
  value: SshCapabilityValue;
  onChange: (value: SshCapabilityValue) => void;
}

/**
 * Capability editor for user SSH certificate issuance (SSH-28): principals,
 * permit-* extension toggles (default on), a "Harden" preset that clears all
 * extensions, force-command + source-address critical options, a TTL picker,
 * and a paste-your-public-key field. Renders a live summary of what will be set.
 */
export function SshCapabilityEditor({ value, onChange }: SshCapabilityEditorProps) {
  const set = (patch: Partial<SshCapabilityValue>) => onChange({ ...value, ...patch });

  const toggleExtension = (ext: SshExtension) => {
    set({
      extensions: value.extensions.includes(ext)
        ? value.extensions.filter((e) => e !== ext)
        : [...value.extensions, ext],
    });
  };

  const harden = () => set({ extensions: [] });
  const enableAll = () => set({ extensions: [...ALL_SSH_EXTENSIONS] });

  return (
    <div className="space-y-6">
      <TagInput
        label="Principals (roles) *"
        tags={value.principals}
        onChange={(principals) => set({ principals })}
        placeholder="e.g. admins (press Enter)"
        help="At least one principal is required. These are matched against AuthorizedPrincipalsFile on hosts."
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">Extensions</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={harden}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-md hover:bg-muted text-destructive"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Harden — clear all
            </button>
            <button
              type="button"
              onClick={enableAll}
              className="px-2.5 py-1 text-xs border rounded-md hover:bg-muted"
            >
              Enable all
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_SSH_EXTENSIONS.map((ext) => {
            const on = value.extensions.includes(ext);
            return (
              <label
                key={ext}
                className={`flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer text-sm ${
                  on ? 'bg-primary/5 border-primary/30' : 'bg-background'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleExtension(ext)}
                  aria-label={ext}
                  className="h-4 w-4"
                />
                <span className="font-mono">{ext}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          All five permit-* extensions are enabled by default. Hardening clears them so the certificate grants no
          forwarding/pty capabilities.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Force command (optional)</label>
          <input
            type="text"
            value={value.forceCommand}
            onChange={(e) => set({ forceCommand: e.target.value })}
            placeholder="/usr/bin/backup.sh"
            className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">force-command critical option.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Source address (optional)</label>
          <input
            type="text"
            value={value.sourceAddress}
            onChange={(e) => set({ sourceAddress: e.target.value })}
            placeholder="10.0.0.0/8,192.168.1.0/24"
            className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">source-address critical option (comma-separated CIDRs).</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Validity (TTL)</label>
        <div className="flex items-center gap-2 flex-wrap">
          {TTL_PRESETS.map((p) => {
            const active = value.validForSeconds === p.seconds;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => set({ validForSeconds: p.seconds })}
                className={`px-3 py-1.5 text-sm border rounded-md ${
                  active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <div className="flex items-center gap-1 text-sm">
            <input
              type="number"
              min={1}
              value={value.validForSeconds}
              onChange={(e) => set({ validForSeconds: Math.max(1, parseInt(e.target.value || '1', 10)) })}
              className="w-32 px-3 py-1.5 border rounded-md bg-background"
              aria-label="Validity in seconds"
            />
            <span className="text-muted-foreground">seconds</span>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">User SSH public key *</label>
        <textarea
          value={value.sshPublicKey}
          onChange={(e) => set({ sshPublicKey: e.target.value })}
          rows={3}
          placeholder="ssh-ed25519 AAAA... user@host"
          className="w-full px-3 py-2 border rounded-md bg-background text-xs font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">Paste the user's public key (not the private key).</p>
      </div>

      {/* Live summary */}
      <div className="p-3 rounded-md bg-muted/50 border text-xs space-y-1">
        <div className="font-medium text-sm mb-1">This certificate will set:</div>
        <div>
          <span className="text-muted-foreground">Extensions:</span>{' '}
          {value.extensions.length === 0 ? (
            <span className="font-mono text-destructive">none (hardened)</span>
          ) : (
            <span className="font-mono">{value.extensions.join(', ')}</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Critical options:</span>{' '}
          {value.forceCommand || value.sourceAddress ? (
            <span className="font-mono">
              {[
                value.forceCommand && `force-command=${value.forceCommand}`,
                value.sourceAddress && `source-address=${value.sourceAddress}`,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          ) : (
            <span className="font-mono text-muted-foreground">none</span>
          )}
        </div>
      </div>
    </div>
  );
}

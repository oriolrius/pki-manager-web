import { DeployPanel } from '@/components/DeployPanel';
import { ConfigSnippet } from '@/components/ConfigSnippet';
import {
  type SshKeyType,
  keyTypeToken,
  userCertFilename,
  userIdentityPath,
  certAuthorityLine,
} from '@/lib/ssh';

/**
 * The "Send to the user" hand-off: the same four copy-paste/download blocks the
 * issuer sees right after signing a user certificate (signed cert, ~/.ssh/config
 * drop-in, Host CA known_hosts line, use-&-verify commands).
 *
 * Shared by the issuance success screen (ssh.users.new) and the per-cert details
 * view on the users list, so both stay identical. The client-only filename /
 * config derivations mirror the backend (see @/lib/ssh); the backend remains the
 * source of truth for the host deploy bundle.
 */
export function CertDeliveryPanel({
  certOpenssh,
  keyType,
  hostCaKeys,
  title = 'Send to the user',
  description = "Each block is copy-paste. The certificate filename already matches the user's key type.",
}: {
  certOpenssh: string;
  keyType: SshKeyType;
  hostCaKeys: string[];
  title?: string;
  description?: string;
}) {
  const certFile = userCertFilename(keyType);
  const idPath = userIdentityPath(keyType);
  const token = keyTypeToken(keyType);
  const caLine = (hostCaKeys ?? []).map((k) => certAuthorityLine(k, '*')).join('\n');
  const sshClientConfig = [
    'Host *',
    `  IdentityFile ${idPath}`,
    `  CertificateFile ${idPath}-cert.pub`,
    '  IdentitiesOnly yes',
    '',
  ].join('\n');
  const commands = [
    '# This certificate only works beside the SAME private key whose public key',
    `# was signed (${idPath}). It is not a credential on its own.`,
    '',
    '# Check what it grants (principals, expiry, options):',
    `ssh-keygen -L -f ${idPath}-cert.pub`,
    '',
    '# Log in. If you added the ~/.ssh/config block above, ssh finds the key and',
    '# certificate automatically — no -i needed:',
    'ssh <account>@<host>',
    '',
    '# If you did NOT set up ~/.ssh/config, point -i at the private key instead',
    `# (ssh auto-presents id_${token}-cert.pub sitting next to it):`,
    `ssh -i ${idPath} <account>@<host>`,
  ].join('\n');

  return (
    <DeployPanel title={title} description={description}>
      <ConfigSnippet
        title="1. SSH certificate"
        requirement="required"
        description={`Save next to the private key as ${certFile} (chmod 644). ssh then presents it automatically.`}
        content={certOpenssh}
        downloadFilename={certFile}
        badge="cert"
        language="blob"
      />
      <ConfigSnippet
        title="2. ~/.ssh/config"
        requirement="optional"
        description="Convenience only — lets you log in without -i. Narrow the Host pattern to your fleet instead of * so unrelated sessions are unaffected."
        content={sshClientConfig}
        downloadFilename="ssh_config"
        badge="ssh_config"
        language="ssh_config"
      />
      {caLine ? (
        <ConfigSnippet
          title="3. Trust the servers' Host CA (known_hosts)"
          requirement="optional"
          description="Silences host-key warnings — login still works without it. Add to ~/.ssh/known_hosts and narrow * to your host pattern."
          content={caLine}
          downloadFilename="known_hosts_cert_authority"
          badge="known_hosts"
          language="blob"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          No Host CA published yet — create a Host CA so clients can verify servers without host-key warnings.
        </p>
      )}
      <ConfigSnippet
        title="4. Use &amp; verify"
        requirement="required"
        description="Verify the certificate, then log in. With the ~/.ssh/config block it's automatic; without it, pass the private key with -i."
        content={commands}
        badge="shell"
        language="shell"
      />
    </DeployPanel>
  );
}

import { createFileRoute, Outlet, Link, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Terminal, ShieldCheck, Server, Users, Tags, Ban, CheckCircle2, Circle, Lock, ArrowRight } from 'lucide-react';
import { Callout } from '@/components/ssh/Callout';

export const Route = createFileRoute('/ssh')({
  component: SshSection,
});

const SUB_NAV = [
  { to: '/ssh/cas', label: 'Certificate Authorities', icon: ShieldCheck },
  { to: '/ssh/hosts', label: 'Hosts', icon: Server },
  { to: '/ssh/users', label: 'Users', icon: Users },
  { to: '/ssh/principals', label: 'Principals', icon: Tags },
  { to: '/ssh/krl', label: 'KRL', icon: Ban },
] as const;

function SshSection() {
  const matchRoute = useMatchRoute();
  const isIndex = matchRoute({ to: '/ssh', fuzzy: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Terminal className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">SSH Certificate Manager</h1>
          <p className="text-sm text-muted-foreground">
            Issue and manage OpenSSH user &amp; host certificates, principals, and KRLs.
          </p>
        </div>
      </div>

      {/* Second-level sub-nav */}
      <div className="flex flex-wrap gap-1 border-b">
        {SUB_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="px-3 py-2 text-sm font-medium rounded-t-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2 border-b-2 border-transparent"
            activeProps={{
              className:
                'px-3 py-2 text-sm font-medium rounded-t-md text-primary bg-primary/10 transition-colors flex items-center gap-2 border-b-2 border-primary',
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </div>

      {isIndex ? <SshLanding /> : <Outlet />}
    </div>
  );
}

function SshLanding() {
  const casQuery = trpc.ssh.ca.list.useQuery();
  const hostsQuery = trpc.ssh.host.list.useQuery();
  const mappingsQuery = trpc.ssh.principal.mappingsByPrincipal.useQuery();
  const certsQuery = trpc.ssh.user.listCertificates.useQuery({});

  if (casQuery.isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  const cas = casQuery.data ?? [];
  const userCa = cas.some((c) => c.caType === 'user' && (c.status === 'active' || c.status === 'rotating'));
  const hostCa = cas.some((c) => c.caType === 'host' && (c.status === 'active' || c.status === 'rotating'));
  const hasHost = (hostsQuery.data ?? []).length > 0;
  const hasMapping = Object.keys(mappingsQuery.data ?? {}).length > 0;
  const hasUserCert = (certsQuery.data ?? []).length > 0;

  const steps = [
    {
      n: 1,
      label: 'Create the User CA',
      done: userCa,
      blocked: false,
      to: '/ssh/cas/new' as const,
      why: "Signs people's login certificates. Each server installs its public key (TrustedUserCAKeys) to trust logins.",
    },
    {
      n: 2,
      label: 'Create the Host CA',
      done: hostCa,
      blocked: false,
      to: '/ssh/cas/new' as const,
      why: "Signs servers' host certificates. Each client adds it as a @cert-authority line to trust hosts.",
    },
    {
      n: 3,
      label: 'Register a host & install its deploy bundle',
      done: hasHost,
      blocked: !(userCa && hostCa),
      to: '/ssh/hosts/new' as const,
      why: "Paste the server's host public key, issue a cert, then place the one-panel deploy bundle on it.",
    },
    {
      n: 4,
      label: 'Define principals & map them to host accounts',
      done: hasMapping,
      blocked: !hasHost,
      to: '/ssh/principals' as const,
      why: 'A principal must be mapped to a local account on a host, or logins with it are denied.',
    },
    {
      n: 5,
      label: 'Issue a user certificate',
      done: hasUserCert,
      blocked: !hasMapping,
      to: '/ssh/users/new' as const,
      why: 'Sign a user public key with principals that match your host mappings.',
    },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <Callout title="How SSH certificates work here">
        Two CAs, two trust directions: the <strong>User CA</strong> signs people (servers trust it), the{' '}
        <strong>Host CA</strong> signs servers (clients trust it). A <strong>principal</strong> is a role label that must
        appear in <strong>both</strong> the user's certificate <em>and</em> the host's{' '}
        <code className="font-mono">auth_principals/&lt;account&gt;</code> file, or login is denied. Everything is
        copy-paste — PKI Manager generates the files; it does not push them.
      </Callout>

      {allDone ? (
        <div className="rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-200 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          Setup complete — your dual CA, a host, principal mappings, and a user certificate all exist.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Getting started</h2>
            <p className="text-sm text-muted-foreground">Follow these steps in order. Each unlocks the next.</p>
          </div>
          <ol className="divide-y">
            {steps.map((s) => (
              <li key={s.n} className="flex items-start gap-3 p-4">
                <div className="mt-0.5">
                  {s.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : s.blocked ? (
                    <Lock className="h-5 w-5 text-muted-foreground/50" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${s.blocked && !s.done ? 'text-muted-foreground' : ''}`}>
                    {s.n}. {s.label}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.why}</p>
                </div>
                {s.blocked && !s.done ? (
                  <span className="text-xs text-muted-foreground/60 whitespace-nowrap mt-1">Locked</span>
                ) : (
                  <Link
                    to={s.to}
                    className="flex items-center gap-1 text-sm text-primary hover:underline whitespace-nowrap mt-0.5"
                  >
                    {s.done ? 'Review' : 'Go'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SUB_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="rounded-lg border bg-card p-5 hover:bg-muted/50 transition-colors flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-medium">{label}</div>
              <div className="text-xs text-muted-foreground">Manage SSH {label.toLowerCase()}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

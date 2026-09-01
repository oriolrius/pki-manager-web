import { createFileRoute, Outlet, Link, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Terminal, ShieldCheck, Server, Users, Tags, Ban, Boxes, CheckCircle2, Circle, Lock, ArrowRight, ChevronDown, LayoutDashboard } from 'lucide-react';
import { Callout } from '@/components/ssh/Callout';
import { ZoneProvider, useZone } from '@/lib/zone-context';
import { ZoneSwitcher } from '@/components/ssh/ZoneSwitcher';

export const Route = createFileRoute('/ssh')({
  component: SshSection,
  validateSearch: (search: Record<string, unknown>): { zone?: string } => ({
    zone: typeof search.zone === 'string' && search.zone ? search.zone : undefined,
  }),
});

const SSH_NAV_GROUPS = [
  {
    label: 'Trust',
    items: [{ to: '/ssh/cas', label: 'Certificate authorities', icon: ShieldCheck }],
  },
  {
    label: 'Access',
    items: [
      { to: '/ssh/principals', label: 'Principals', icon: Tags },
      { to: '/ssh/hosts', label: 'Hosts', icon: Server },
      { to: '/ssh/users', label: 'User certificates', icon: Users },
    ],
  },
  {
    label: 'Security',
    items: [{ to: '/ssh/krl', label: 'Revocation & KRL', icon: Ban }],
  },
  {
    label: 'Administration',
    items: [{ to: '/ssh/zones', label: 'Zones', icon: Boxes }],
  },
] as const;

const SSH_NAV_ITEMS = [
  { to: '/ssh', label: 'Overview', icon: LayoutDashboard },
  ...SSH_NAV_GROUPS.flatMap((group) => group.items),
] as const;

function SshSection() {
  return (
    <ZoneProvider>
      <SshSectionInner />
    </ZoneProvider>
  );
}

function SshSectionInner() {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const isIndex = matchRoute({ to: '/ssh', fuzzy: false });
  const activeItem = SSH_NAV_ITEMS.find(({ to }) => matchRoute({ to, fuzzy: true })) ?? SSH_NAV_ITEMS[0];

  const navigateTo = (to: typeof SSH_NAV_ITEMS[number]['to']) => {
    navigate({ to, search: (prev) => prev });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Terminal className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">SSH Certificate Manager</h1>
            <p className="text-sm text-muted-foreground">
              Issue and manage OpenSSH user &amp; host certificates, principals, and KRLs.
            </p>
          </div>
        </div>
        <div className="sm:ml-auto">
          <ZoneSwitcher />
        </div>
      </div>

      <nav aria-label="SSH workspace" className="border-y bg-muted/30">
        <div className="hidden min-h-12 items-stretch md:flex">
          <Link
            to="/ssh"
            search={(prev) => prev}
            className="flex items-center gap-2 border-r px-4 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
            activeProps={{ className: 'flex items-center gap-2 border-r bg-primary/10 px-4 text-sm font-medium text-primary' }}
            activeOptions={{ exact: true }}
          >
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </Link>
          {SSH_NAV_GROUPS.map((group) => {
            const groupActive = group.items.some(({ to }) => matchRoute({ to, fuzzy: true }));
            return (
              <details
                key={group.label}
                className="group relative border-r"
                data-navigation-menu
              >
                <summary
                  onClick={(event) => {
                    const currentMenu = event.currentTarget.parentElement;
                    document.querySelectorAll<HTMLDetailsElement>('details[data-navigation-menu]').forEach((menu) => {
                      if (menu !== currentMenu) menu.open = false;
                    });
                  }}
                  className={`flex h-full cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium transition-colors hover:bg-accent/50 hover:text-foreground [&::-webkit-details-marker]:hidden ${
                    groupActive ? 'bg-primary/10 text-primary' : 'text-foreground/70'
                  }`}
                >
                  {group.label}
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute left-0 top-full z-30 mt-px min-w-60 rounded-b-md border border-t-0 bg-popover p-1 shadow-lg">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <Link
                      key={to}
                      to={to}
                      search={(prev) => prev}
                      className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
                      activeProps={{ className: 'flex items-center gap-2 rounded-sm bg-primary/10 px-3 py-2 text-sm text-primary' }}
                      onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
        <label className="flex items-center gap-3 px-3 py-2 md:hidden">
          <span className="text-sm font-medium text-muted-foreground">Section</span>
          <select
            value={activeItem.to}
            onChange={(event) => navigateTo(event.target.value as typeof SSH_NAV_ITEMS[number]['to'])}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            data-testid="ssh-section-switcher"
          >
            <option value="/ssh">Overview</option>
            {SSH_NAV_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map(({ to, label }) => (
                  <option key={to} value={to}>{label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </nav>

      {isIndex ? <SshLanding /> : <Outlet />}
    </div>
  );
}

function SshLanding() {
  const { zoneId } = useZone();
  const casQuery = trpc.ssh.ca.list.useQuery({ zoneId });
  const hostsQuery = trpc.ssh.host.list.useQuery({ zoneId });
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
        {SSH_NAV_GROUPS.flatMap((group) => group.items).map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            search={(prev) => prev}
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

import { Github, Globe } from 'lucide-react';

const PROJECT_LINKS = [
  { href: 'https://github.com/oriolrius/pki-manager-web', label: 'Source code on GitHub', Icon: Github },
  { href: 'https://pki-manager.oriolrius.cat', label: 'Project website and documentation', Icon: Globe },
] as const;

/** Footer with the version and links to the project's source code and website. */
export function AppFooter({ version }: { version: string }) {
  return (
    <footer className="border-t">
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>PKI Manager v{version}</span>
        <nav aria-label="Project links" className="flex items-center gap-1">
          {PROJECT_LINKS.map(({ href, label, Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

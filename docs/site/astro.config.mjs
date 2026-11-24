// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const REPO = 'https://github.com/oriolrius/pki-manager-web';

export default defineConfig({
  site: 'https://oriolrius.github.io',
  base: '/pki-manager-web',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'PKI Manager',
      description: 'Run your own X.509 and SSH certificate authorities: CA hierarchies, certificates, CRLs, Kubernetes issuer, SSH CA.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/` },
      customCss: ['./src/styles/theme.css'],
      lastUpdated: false,
      sidebar: [
        { label: 'Get started', items: [{ autogenerate: { directory: 'get-started' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        {
          label: 'SSH certificates',
          items: [
            { label: 'Video series and reference', link: '/ssh/videos/' },
            ...['concept', 'operator-quickstart', 'setup', 'deploy-server-and-user', 'principals-guide', 'zones', 'host-blocks-runbook', 'ansible-role', 'api-contract'].map((s) => ({ slug: `ssh/${s}` })),
          ],
        },
        { label: 'Operations', items: [{ autogenerate: { directory: 'operations' } }] },
        { label: 'API reference', items: [{ autogenerate: { directory: 'api' } }] },
      ],
    }),
  ],
});

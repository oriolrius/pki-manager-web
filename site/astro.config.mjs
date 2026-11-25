// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import { REDIRECTS } from './docs.config.mjs';

const REPO = 'https://github.com/oriolrius/pki-manager-web';
const BASE = '/pki-manager-web';

export default defineConfig({
  site: 'https://oriolrius.github.io',
  base: BASE,
  trailingSlash: 'always',
  // Pages that moved keep their old address (docs.config.mjs).
  redirects: Object.fromEntries(Object.entries(REDIRECTS).map(([from, to]) => [`/${from}`, `${BASE}/${to}/`])),
  integrations: [
    starlight({
      title: 'PKI Manager',
      description: 'Run your own X.509 and SSH certificate authorities: CA hierarchies, certificates, CRLs, Kubernetes issuer, SSH CA.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/` },
      customCss: ['./src/styles/theme.css'],
      // Version badge next to the title, versions line under each page title
      components: { SiteTitle: './src/components/SiteTitle.astro', PageTitle: './src/components/PageTitle.astro', Footer: './src/components/Footer.astro' },
      // OpenAPI reference generated from the backend source at build time (scripts/openapi.mjs).
      plugins: [
        starlightOpenAPI([
          {
            base: 'api/reference',
            schema: './src/openapi/openapi.json',
            sidebar: { label: 'Endpoints', collapsed: true, operations: { badges: true, labels: 'summary' } },
          },
        ]),
      ],
      lastUpdated: false,
      // Every page comes from the repository (scripts/sync-docs.mjs). Order and labels: docs.config.mjs.
      sidebar: [
        {
          label: 'Product',
          items: [
            { label: 'Overview', link: '/' },
            { label: 'Features', link: '/features/' },
            { label: 'How it works', link: '/how-it-works/' },
            { label: 'About this project', link: '/about/' },
          ],
        },
        { label: 'Get started', items: [{ autogenerate: { directory: 'get-started' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        {
          label: 'SSH certificates',
          items: [{ label: 'Video series and reference', link: '/ssh/videos/' }, { autogenerate: { directory: 'ssh' } }],
        },
        { label: 'Operations', items: [{ autogenerate: { directory: 'operations' } }] },
        { label: 'API reference', items: [{ autogenerate: { directory: 'api' } }, ...openAPISidebarGroups] },
        {
          label: 'Project',
          items: [
            { autogenerate: { directory: 'development' } },
            { label: 'Decision records', collapsed: true, items: [{ autogenerate: { directory: 'project/decisions' } }] },
            { label: 'Specifications', collapsed: true, items: [{ autogenerate: { directory: 'project/specs' } }] },
          ],
        },
      ],
    }),
  ],
});

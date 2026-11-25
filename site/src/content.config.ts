import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Both collections are written by scripts/sync-docs.mjs from the repository (docs/, backlog/, ...).
// Nothing under src/content/ is written by hand.

// `pki`: the releases of a page (see src/components/PageTitle.astro).
const pki = z.object({ changedIn: z.string().nullable(), testedWith: z.string().optional() }).optional();
const link = z.object({ label: z.string(), href: z.string() });

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema({ extend: z.object({ pki }) }) }),
  // Product pages: docs/index.md, docs/about.md, docs/how-it-works.md, docs/features/*.md
  product: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/product' }),
    schema: ({ image }) =>
      z.object({
        title: z.string(),
        summary: z.string(),
        source: z.string(),
        group: z.string().optional(),
        order: z.number().optional(),
        image: image().optional(),
        imageAlt: z.string().optional(),
        links: z.array(link).optional(),
        groups: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), link: link.optional() })).optional(),
        facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      }),
  }),
};

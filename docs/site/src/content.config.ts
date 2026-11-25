import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// `pki` is written by scripts/sync-docs.mjs for each synced repo doc (see src/components/PageTitle.astro).
const pki = z.object({ changedIn: z.string().nullable(), testedWith: z.string().optional() }).optional();

export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema({ extend: z.object({ pki }) }) }) };

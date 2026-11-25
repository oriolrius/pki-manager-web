// The product pages come from the `product` collection: Markdown under docs/ in the repository.
import { getCollection, type CollectionEntry } from 'astro:content';

export type ProductPage = CollectionEntry<'product'>;

export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
/** Site URL of a path: url('features') -> /features/ */
export const url = (path = '') => `${base}/${path ? path.replace(/^\/|\/$/g, '') + '/' : ''}`;

/** The page that was written from this repository file. */
export async function page(source: string): Promise<ProductPage> {
  const found = (await getCollection('product')).find((e) => e.data.source === source);
  if (!found) throw new Error(`product page not found: ${source}`);
  return found;
}

/** URL path of a product page: docs/features/x.md -> features/x */
export const pathOf = (p: ProductPage) => p.data.source.replace(/^docs\//, '').replace(/\.md$/, '').replace(/(^|\/)index$/, '');

/** Feature pages in the order of their `order` field. */
export async function features(): Promise<ProductPage[]> {
  return (await getCollection('product'))
    .filter((e) => e.data.source.startsWith('docs/features/') && !e.data.source.endsWith('/index.md'))
    .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99));
}

/** The groups of docs/features/index.md, each with its feature pages. */
export async function featureGroups() {
  const index = await page('docs/features/index.md');
  const all = await features();
  return (index.data.groups ?? []).map((g) => ({ ...g, features: all.filter((f) => f.data.group === g.id) }));
}

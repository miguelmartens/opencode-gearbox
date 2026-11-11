import type { Product } from './products.ts';

export type SearchOptions = { query?: string; tag?: string; maxPrice?: number };

/** Products matching every given option, sorted by name. */
export function searchProducts(products: Product[], opts: SearchOptions = {}): Product[] {
  const q = opts.query?.trim().toLowerCase();
  return products
    .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
    .filter((p) => (opts.tag ? p.tags.includes(opts.tag) : true))
    .filter((p) => (opts.maxPrice !== undefined ? p.price <= opts.maxPrice : true))
    .sort((a, b) => a.name.localeCompare(b.name));
}

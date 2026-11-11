import type { Product } from './products.ts';

/** One line per product: `name — $price`. */
export function renderListing(products: Product[]): string {
  return products.map((p) => `${p.name} — $${p.price.toFixed(2)}`).join('\n');
}

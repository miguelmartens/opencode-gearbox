/** Joins non-empty items with `sep`. */
export function joinList(items: string[], sep: string): string {
  return items.filter((item) => item.length > 0).join(sep);
}

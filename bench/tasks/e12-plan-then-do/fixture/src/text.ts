/** Replaces every run of whitespace with a single space. */
export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/** Lower-case, dash-separated identifier made of letters and digits. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

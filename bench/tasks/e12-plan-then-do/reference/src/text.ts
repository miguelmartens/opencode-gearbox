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

/** Trims every string and drops the ones left empty. */
export function trimAll(strings: string[]): string[] {
  return strings.map((s) => s.trim()).filter((s) => s.length > 0);
}

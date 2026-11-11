/** Upper-cases the first character and leaves the rest as is. */
export function capitalize(s: string): string {
  if (s === '') return '';
  return s[0].toUpperCase() + s.slice(1);
}

/** Capitalizes every space-separated word, keeping the spacing. */
export function titleCase(s: string): string {
  return s.split(' ').map(capitalize).join(' ');
}

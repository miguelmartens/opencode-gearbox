// POSIX path helpers for the browser build, where `node:path` is not available.

/** Collapses `.`, `..` and repeated slashes. */
export function normalize(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined;
}

/** Joins the parts with `/` and normalizes the result. */
export function join(...parts: string[]): string {
  return normalize(parts.join('/'));
}

/** The path from the absolute path `from` to the absolute path `to`. */
export function relative(from: string, to: string): string {
  const a = normalize(from).split('/').filter(Boolean);
  const b = normalize(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** Everything before the last segment. */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return path.slice(0, i);
}

/** The last segment. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

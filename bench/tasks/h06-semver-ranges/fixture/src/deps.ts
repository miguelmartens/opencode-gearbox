import { compare, satisfies } from './semver.ts';

/** Names whose installed version is missing or outside the manifest's range, sorted. */
export function brokenDeps(
  manifest: Record<string, string>,
  installed: Record<string, string>,
): string[] {
  return Object.keys(manifest)
    .filter((name) => {
      const version = installed[name];
      return version === undefined || !satisfies(version, manifest[name]!);
    })
    .sort();
}

/** The highest of `versions` that satisfies `range`, or null. */
export function maxSatisfying(versions: string[], range: string): string | null {
  const ok = versions.filter((version) => satisfies(version, range));
  if (ok.length === 0) return null;
  return ok.reduce((best, version) => (compare(version, best) > 0 ? version : best));
}

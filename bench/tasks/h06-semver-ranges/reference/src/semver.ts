// A small semver implementation for the dependency checker, so it needs no packages. It follows
// npm's `semver` (v7) with its default options: no `loose`, no `includePrerelease`.

export type Version = { major: number; minor: number; patch: number; prerelease: string[] };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parse(text: string): Version | null {
  const m = VERSION.exec(text.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

const NUMERIC = /^\d+$/;

/** SemVer 2.0.0 §11: numeric identifiers compare as numbers and sort before alphanumeric ones. */
function compareIdentifiers(a: string, b: string): number {
  const an = NUMERIC.test(a);
  const bn = NUMERIC.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an !== bn) return an ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareVersions(x: Version, y: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  const p = x.prerelease;
  const q = y.prerelease;
  if (p.length === 0 || q.length === 0) return Math.sign(q.length - p.length);
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const r = compareIdentifiers(p[i]!, q[i]!);
    if (r !== 0) return r;
  }
  return 0;
}

/** -1, 0 or 1 by SemVer 2.0.0 precedence; build metadata is ignored. */
export function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new TypeError(`invalid version: ${!x ? a : b}`);
  return compareVersions(x, y);
}

type Op = '<' | '<=' | '>' | '>=' | '=';
type Comparator = { op: Op; version: Version };

/** A version in a range where any part may be missing or a wildcard (`x`, `X`, `*`). */
type Partial = { major?: number; minor?: number; patch?: number; prerelease: string[] };

const PARTIAL =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*])(?:\.(\d+|[xX*])(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?)?)?$/;

function parsePartial(text: string): Partial | null {
  const m = PARTIAL.exec(text);
  if (!m) return null;
  const num = (s: string | undefined) => (s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s));
  const major = num(m[1]);
  const minor = major === undefined ? undefined : num(m[2]);
  const patch = minor === undefined ? undefined : num(m[3]);
  return { major, minor, patch, prerelease: patch === undefined || !m[4] ? [] : m[4].split('.') };
}

const ver = (major: number, minor: number, patch: number, prerelease: string[] = []): Version => ({
  major,
  minor,
  patch,
  prerelease,
});
/** The lowest prerelease of a release: the exclusive upper bound of npm's desugared ranges. */
const below = (major: number, minor: number, patch: number) => ver(major, minor, patch, ['0']);
const ge = (version: Version): Comparator => ({ op: '>=', version });
const lt = (version: Version): Comparator => ({ op: '<', version });
/** Matches nothing. */
const NONE: Comparator[] = [lt(below(0, 0, 0))];

/** The lowest version a partial allows: missing parts are 0. */
const floor = (p: Partial) => ver(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.prerelease);

function caret(p: Partial): Comparator[] {
  if (p.major === undefined) return [];
  const low = ge(floor(p));
  if (p.minor === undefined) return [low, lt(below(p.major + 1, 0, 0))];
  if (p.major > 0) return [low, lt(below(p.major + 1, 0, 0))];
  if (p.patch === undefined) return [low, lt(below(0, p.minor + 1, 0))];
  if (p.minor > 0) return [low, lt(below(0, p.minor + 1, 0))];
  return [low, lt(below(0, 0, p.patch + 1))];
}

function tilde(p: Partial): Comparator[] {
  if (p.major === undefined) return [];
  const low = ge(floor(p));
  if (p.minor === undefined) return [low, lt(below(p.major + 1, 0, 0))];
  return [low, lt(below(p.major, p.minor + 1, 0))];
}

/** A primitive comparator or a bare (x-)range such as `1.2` or `=1.x`. */
function primitive(op: string, p: Partial): Comparator[] {
  if (p.major === undefined) return op === '<' || op === '>' ? NONE : [];
  if (p.patch !== undefined) return [{ op: (op || '=') as Op, version: floor(p) }];
  // A partial version: `1` is 1.0.0 up to below 2.0.0, `1.2` is 1.2.0 up to below 1.3.0.
  const next =
    p.minor === undefined ? below(p.major + 1, 0, 0) : below(p.major, p.minor + 1, 0);
  switch (op) {
    case '>':
      return [ge(ver(next.major, next.minor, next.patch))];
    case '>=':
      return [ge(floor(p))];
    case '<':
      return [lt(below(p.major, p.minor ?? 0, 0))];
    case '<=':
      return [lt(next)];
    default:
      return [ge(floor(p)), lt(next)];
  }
}

function desugar(token: string): Comparator[] | null {
  const m = /^(<=|>=|<|>|=|~>?|\^)?(.*)$/.exec(token)!;
  const op = m[1] ?? '';
  const p = parsePartial(m[2]!);
  if (!p) return null;
  if (op === '^') return caret(p);
  if (op.startsWith('~')) return tilde(p);
  return primitive(op, p);
}

function hyphen(fromText: string, toText: string): Comparator[] | null {
  const from = parsePartial(fromText);
  const to = parsePartial(toText);
  if (!from || !to) return null;
  const out: Comparator[] = from.major === undefined ? [] : [ge(floor(from))];
  if (to.major === undefined) return out;
  if (to.minor === undefined) return [...out, lt(below(to.major + 1, 0, 0))];
  if (to.patch === undefined) return [...out, lt(below(to.major, to.minor + 1, 0))];
  return [...out, { op: '<=', version: floor(to) }];
}

/** One `||` alternative as comparators; `null` when it does not parse. */
function comparatorSet(set: string): Comparator[] | null {
  const range = /^(\S+)\s+-\s+(\S+)$/.exec(set);
  if (range) return hyphen(range[1]!, range[2]!);
  // `>= 1.2.3` means `>=1.2.3`.
  const tokens = set.replace(/(<=|>=|<|>|=|~>?|\^)\s+/g, '$1').split(/\s+/).filter(Boolean);
  const out: Comparator[] = [];
  for (const token of tokens) {
    const comparators = desugar(token);
    if (!comparators) return null;
    out.push(...comparators);
  }
  return out;
}

function holds(version: Version, c: Comparator): boolean {
  const r = compareVersions(version, c.version);
  switch (c.op) {
    case '<':
      return r < 0;
    case '<=':
      return r <= 0;
    case '>':
      return r > 0;
    case '>=':
      return r >= 0;
    case '=':
      return r === 0;
  }
}

const sameTuple = (a: Version, b: Version) =>
  a.major === b.major && a.minor === b.minor && a.patch === b.patch;

function inSet(version: Version, set: Comparator[]): boolean {
  if (!set.every((c) => holds(version, c))) return false;
  if (version.prerelease.length === 0) return true;
  // A prerelease only matches a set that names a prerelease of the same release.
  return set.some((c) => c.version.prerelease.length > 0 && sameTuple(c.version, version));
}

/** True when `version` is in `range` (npm range syntax); false for an invalid version or range. */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  return range.split('||').some((alternative) => {
    const set = comparatorSet(alternative.trim());
    return set !== null && inSet(v, set);
  });
}

// A small semver implementation for the dependency checker, so it needs no packages.

export type Version = { major: number; minor: number; patch: number; prerelease: string[] };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

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

/** -1, 0 or 1 by precedence. */
export function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new TypeError(`invalid version: ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  const p = x.prerelease.join('.');
  const q = y.prerelease.join('.');
  if (p === q) return 0;
  if (!p) return 1;
  if (!q) return -1;
  return p < q ? -1 : 1;
}

type Comparator = { op: '<' | '<=' | '>' | '>=' | '='; version: string };

/** `1`, `1.2`, `1.x`, `1.2.*` → the missing parts as 0, plus how many parts were given. */
function partial(text: string): { major: number; minor: number; patch: number; given: number; pre: string } {
  const [core, pre = ''] = text.split('-', 2) as [string, string?];
  const parts = core.split('.').filter((p) => p !== '' && !/^[xX*]$/.test(p));
  return {
    major: Number(parts[0] ?? 0),
    minor: Number(parts[1] ?? 0),
    patch: Number(parts[2] ?? 0),
    given: parts.length,
    pre,
  };
}

const v = (major: number, minor: number, patch: number, pre = '') =>
  `${major}.${minor}.${patch}${pre ? `-${pre}` : ''}`;

function desugar(token: string): Comparator[] {
  if (token === '' || token === '*' || /^[xX]$/.test(token)) return [];
  const m = /^(<=|>=|<|>|=|~|\^)?(.*)$/.exec(token)!;
  const op = m[1] ?? '';
  const p = partial(m[2]!);
  const low = v(p.major, p.minor, p.patch, p.pre);
  if (op === '^') {
    if (p.major === 0) return [{ op: '>=', version: low }, { op: '<', version: v(1, 0, 0) }];
    return [{ op: '>=', version: low }, { op: '<', version: v(p.major + 1, 0, 0) }];
  }
  if (op === '~') {
    if (p.given === 1) return [{ op: '>=', version: low }, { op: '<', version: v(p.major + 1, 0, 0) }];
    return [{ op: '>=', version: low }, { op: '<', version: v(p.major, p.minor + 1, 0) }];
  }
  if (op === '' || op === '=') {
    if (p.given === 3) return [{ op: '=', version: low }];
    if (p.given === 2) return [{ op: '>=', version: low }, { op: '<', version: v(p.major, p.minor + 1, 0) }];
    return [{ op: '>=', version: low }, { op: '<', version: v(p.major + 1, 0, 0) }];
  }
  return [{ op: op as Comparator['op'], version: low }];
}

function test1(version: string, c: Comparator): boolean {
  const r = compare(version, c.version);
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

function comparators(set: string): Comparator[] {
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
  if (hyphen) {
    const a = partial(hyphen[1]!);
    const b = partial(hyphen[2]!);
    return [
      { op: '>=', version: v(a.major, a.minor, a.patch, a.pre) },
      { op: '<=', version: v(b.major, b.minor, b.patch, b.pre) },
    ];
  }
  return set.split(/\s+/).flatMap(desugar);
}

/** True when `version` is in `range` (npm range syntax). */
export function satisfies(version: string, range: string): boolean {
  if (!parse(version)) return false;
  return range
    .split('||')
    .map((set) => set.trim())
    .some((set) => comparators(set).every((c) => test1(version, c)));
}

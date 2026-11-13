import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = () => import(join(dir, 'src', 'semver.ts'));
const deps = () => import(join(dir, 'src', 'deps.ts'));

// npm `semver` v7, default options. Each case: version, range, expected.
const CASES: Array<[string, string, boolean]> = [
  // caret on 0.x
  ['0.2.5', '^0.2.3', true],
  ['0.3.0', '^0.2.3', false],
  ['0.0.3', '^0.0.3', true],
  ['0.0.4', '^0.0.3', false],
  ['0.0.9', '^0.0.x', true],
  ['0.1.0', '^0.0.x', false],
  ['0.9.0', '^0.x', true],
  ['1.0.0', '^0', false],
  ['1.9.9', '^1.x', true],
  // tilde
  ['1.2.9', '~1.2', true],
  ['1.3.0', '~1.2', false],
  ['1.9.0', '~1', true],
  ['0.2.9', '~0.2.3', true],
  ['0.3.0', '~0.2.3', false],
  // x-ranges in comparators
  ['1.3.0', '>1.2', true],
  ['1.2.9', '>1.2', false],
  ['1.2.9', '<=1.2', true],
  ['1.3.0', '<=1.2', false],
  ['1.1.9', '<1.2', true],
  ['1.2.0', '<1.2', false],
  ['2.0.0', '>=1', true],
  // hyphen ranges with partial versions
  ['2.3.9', '1.2 - 2.3', true],
  ['2.4.0', '1.2 - 2.3', false],
  ['2.9.9', '1 - 2', true],
  ['3.0.0', '1 - 2', false],
  ['1.1.9', '1.2 - 2.3.4', false],
  ['2.3.4', '1.2.3 - 2.3.4', true],
  ['2.3.5', '1.2.3 - 2.3.4', false],
  // prereleases: only when the range names a prerelease of the same release
  ['1.2.3-beta.4', '^1.2.3-beta.2', true],
  ['1.2.4-beta.2', '^1.2.3-beta.2', false],
  ['1.2.3-beta.1', '^1.2.3-beta.2', false],
  ['1.2.3-alpha', '<1.2.3', false],
  ['1.0.0-beta', '*', false],
  ['1.0.0-beta', '>=1.0.0-alpha', true],
  ['2.0.0-beta.1', '^1.2.3', false],
  ['1.5.0-beta', '1.x', false],
  ['1.2.3-rc.1', '1.2.3-rc.1', true],
  ['1.2.3-rc.1', '>=1.2.3-rc.1 <1.2.4', true],
  ['1.2.4-rc.1', '>=1.2.3-rc.1 <1.2.4', false],
  ['1.2.3-beta.2', '~1.2.3-beta.1', true],
  ['1.3.0-beta', '~1.2.3-beta.1', false],
  ['1.0.0-beta.11', '>1.0.0-beta.2', true],
  ['0.0.3-beta', '^0.0.3-beta', true],
  ['0.0.4', '^0.0.3-beta', false],
  ['1.2.3-beta', '1.2.3-alpha || 1.2.3-beta', true],
  // build metadata and spacing
  ['1.2.3+build.5', '1.2.3', true],
  ['1.2.3', '>= 1.2.0 < 1.3.0', true],
  ['1.3.0', '>= 1.2.0 < 1.3.0', false],
];

const ORDER = [
  '1.0.0-1',
  '1.0.0-alpha',
  '1.0.0-alpha.1',
  '1.0.0-alpha.9',
  '1.0.0-alpha.10',
  '1.0.0-alpha.beta',
  '1.0.0-beta',
  '1.0.0-beta.2',
  '1.0.0-beta.11',
  '1.0.0-rc.1',
  '1.0.0',
  '1.0.1',
  '1.10.0',
  '2.0.0',
];

describe('semver follows npm', () => {
  for (const [version, range, expected] of CASES)
    test(`satisfies(${version}, ${JSON.stringify(range)}) is ${expected}`, async () => {
      const { satisfies } = await load();
      expect(satisfies(version, range)).toBe(expected);
    });

  test('compare follows SemVer 2.0.0 precedence', async () => {
    const { compare } = await load();
    for (let i = 0; i < ORDER.length; i++)
      for (let j = 0; j < ORDER.length; j++)
        expect([ORDER[i], ORDER[j], compare(ORDER[i]!, ORDER[j]!)]).toEqual([
          ORDER[i],
          ORDER[j],
          Math.sign(i - j),
        ]);
    expect(compare('1.0.0+build.1', '1.0.0')).toBe(0);
  });

  test('releases match npm on many random ranges', async () => {
    const { satisfies } = await load();
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const n = () => String(Math.floor(rnd() * 3));
    // Wildcards only at the end, as npm users write them.
    const partial = () => {
      const k = Math.floor(rnd() * 3) + 1;
      const parts = [n(), n(), n()].slice(0, k);
      if (rnd() < 0.2 && k > 1) parts[k - 1] = 'x';
      return parts.join('.');
    };
    const ops = ['', '^', '~', '>', '>=', '<', '<=', '='];
    const comp = () => ops[Math.floor(rnd() * ops.length)] + partial();
    const range = () => {
      const k = rnd();
      if (k < 0.15) return `${partial()} - ${partial()}`;
      if (k < 0.3) return `${comp()} || ${comp()}`;
      if (k < 0.5) return `${comp()} ${comp()}`;
      return comp();
    };
    for (let i = 0; i < 5000; i++) {
      const version = `${n()}.${n()}.${n()}`;
      const r = range();
      expect([version, r, satisfies(version, r)]).toEqual([
        version,
        r,
        Bun.semver.satisfies(version, r),
      ]);
    }
  });

  test('maxSatisfying skips prereleases the range does not name', async () => {
    const { maxSatisfying } = await deps();
    expect(maxSatisfying(['1.2.0', '1.3.0-beta.1', '2.0.0-rc.1'], '^1.0.0')).toBe('1.2.0');
    expect(maxSatisfying(['1.0.0-beta.2', '1.0.0-beta.11'], '>=1.0.0-beta.1')).toBe('1.0.0-beta.11');
  });

  test('src/ uses no package', () => {
    for (const file of ['semver.ts', 'deps.ts']) {
      const source = readFileSync(join(dir, 'src', file), 'utf8');
      expect(source).not.toMatch(/from\s+['"][^.'"][^'"]*['"]/);
    }
  });
});

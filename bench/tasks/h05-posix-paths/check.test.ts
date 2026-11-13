import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { posix } from 'node:path';

const dir = process.env.WORK_DIR!;
const file = joinPath(dir, 'src', 'paths.ts');
const load = () => import(file);

/** A seeded generator, so a failure names an input that reproduces. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

const SEGMENTS = ['', '', '.', '..', '..', 'a', 'b', 'c.txt', '.git', '...', 'a b'];

function randomPath(next: () => number, absolute: boolean | null = null): string {
  const n = Math.floor(next() * 6);
  const parts = Array.from({ length: n }, () => SEGMENTS[Math.floor(next() * SEGMENTS.length)]!);
  let path = parts.join('/');
  const lead = absolute ?? next() < 0.5;
  if (lead) path = (next() < 0.2 ? '//' : '/') + path;
  if (next() < 0.3) path += '/';
  return path;
}

const FIXED = [
  '', '.', '..', '/', '//', '///', './', '../', '/..', '/../', 'a/..', 'a/../', '../a', '../../a/b',
  'a//b', 'a/./b/', '/a/b/..', '/a/b/../..', '/a/b/../../..', 'a/b/../../..', '..a', 'a..', '.../a',
  '/./', '//a', '//a/b', 'a/', '/a/', '/a//', 'a b/../c',
];

describe('paths match node:path posix', () => {
  test('src/paths.ts does not import node:path or a package', () => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/from\s+['"](node:)?path['"]/);
    expect(source).not.toMatch(/import\s*\(?\s*['"][^.'"][^'"]*['"]/);
  });

  test('normalize', async () => {
    const { normalize } = await load();
    const next = rng(1);
    const inputs = [...FIXED, ...Array.from({ length: 2000 }, () => randomPath(next))];
    for (const p of inputs) expect([p, normalize(p)]).toEqual([p, posix.normalize(p)]);
  });

  test('dirname and basename', async () => {
    const { dirname, basename } = await load();
    const next = rng(2);
    const inputs = [...FIXED, ...Array.from({ length: 2000 }, () => randomPath(next))];
    for (const p of inputs) {
      expect([p, dirname(p)]).toEqual([p, posix.dirname(p)]);
      expect([p, basename(p)]).toEqual([p, posix.basename(p)]);
    }
  });

  test('join', async () => {
    const { join } = await load();
    const next = rng(3);
    expect(join()).toBe(posix.join());
    for (let k = 0; k < 2000; k++) {
      const parts = Array.from({ length: Math.floor(next() * 4) + 1 }, () => randomPath(next));
      expect([parts, join(...parts)]).toEqual([parts, posix.join(...parts)]);
    }
  });

  test('relative between absolute paths', async () => {
    const { relative } = await load();
    const next = rng(4);
    const fixed: Array<[string, string]> = [
      ['/a', '/a'], ['/', '/'], ['/', '/a'], ['/a', '/'], ['/a/b', '/a'], ['/a', '/a/b'],
      ['/ab', '/a'], ['/a', '/ab'], ['/a/b/c', '/a/d'], ['/a/', '/a/b/'], ['//a/../b', '/b'],
      ['/a/b/../c', '/a/c/d'], ['/x/y', '/a/b'],
    ];
    for (const [from, to] of fixed)
      expect([from, to, relative(from, to)]).toEqual([from, to, posix.relative(from, to)]);
    for (let k = 0; k < 2000; k++) {
      const from = randomPath(next, true);
      const to = randomPath(next, true);
      expect([from, to, relative(from, to)]).toEqual([from, to, posix.relative(from, to)]);
    }
  });
});

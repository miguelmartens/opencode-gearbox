import { expect, test } from 'bun:test';
import { expectedOutput, shouldSwitch } from '../../src/core/cost.ts';

const from = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const to = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`).toBeTruthy();
}

test('expectedOutput follows the Global Constraints table', () => {
  expect(expectedOutput('low')).toBe(800);
  expect(expectedOutput('medium')).toBe(3000);
  expect(expectedOutput('high')).toBe(8000);
  expect(expectedOutput('xhigh')).toBe(16000);
  expect(expectedOutput('max')).toBe(32000);
});

test('shouldSwitch stays on a large warm cache', () => {
  const r = shouldSwitch({
    contextTokens: 150_000,
    cacheWarm: true,
    from,
    to,
    expectedOutput: 1000,
    minSavingRatio: 0.2,
  });
  near(r.stayUSD, 0.1);
  near(r.goUSD, 0.1925);
  expect(r.switch).toBe(false);
});

test('shouldSwitch switches when output dominates a small warm context', () => {
  const r = shouldSwitch({
    contextTokens: 10_000,
    cacheWarm: true,
    from,
    to,
    expectedOutput: 4000,
    minSavingRatio: 0.2,
  });
  near(r.stayUSD, 0.105);
  near(r.goUSD, 0.0325);
  expect(r.switch).toBe(true);
});

test('shouldSwitch switches for a fresh subagent with no context', () => {
  const r = shouldSwitch({
    contextTokens: 0,
    cacheWarm: false,
    from,
    to,
    expectedOutput: 3000,
    minSavingRatio: 0.2,
  });
  expect(r.switch).toBe(true);
});

test('shouldSwitch prices a cold cache at full input on both sides', () => {
  const r = shouldSwitch({
    contextTokens: 100_000,
    cacheWarm: false,
    from,
    to,
    expectedOutput: 0,
    minSavingRatio: 0.2,
  });
  near(r.stayUSD, 0.5);
  near(r.goUSD, 0.125);
});

test('shouldSwitch falls back to input price when cacheWrite is 0', () => {
  const r = shouldSwitch({
    contextTokens: 100_000,
    cacheWarm: true,
    from,
    to: { ...to, cacheWrite: 0 },
    expectedOutput: 0,
    minSavingRatio: 0.2,
  });
  near(r.goUSD, 0.1);
});

test('shouldSwitch needs the saving to reach minSavingRatio', () => {
  // stay = 0.1, go = 0.08: exactly 20% cheaper switches, 21% required does not.
  const base = {
    contextTokens: 0,
    cacheWarm: true,
    from: { input: 0, output: 100, cacheRead: 0, cacheWrite: 0 },
    to: { input: 0, output: 80, cacheRead: 0, cacheWrite: 0 },
    expectedOutput: 1000,
  };
  expect(shouldSwitch({ ...base, minSavingRatio: 0.2 }).switch).toBe(true);
  expect(shouldSwitch({ ...base, minSavingRatio: 0.21 }).switch).toBe(false);
});

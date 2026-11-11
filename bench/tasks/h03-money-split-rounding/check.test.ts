import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = (name: string) => import(join(dir, 'src', name));
// -0 and 0 are the same amount of money.
const norm = (xs: number[]) => xs.map((x) => x + 0);

/** Largest remainder, ties to the lower index; negative totals mirror positive ones. */
function oracle(total: number, weights: number[]): number[] {
  if (total < 0) return oracle(-total, weights).map((s) => 0 - s);
  const W = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((total * w) / W));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const idx = weights.map((_, i) => i);
  idx.sort((a, b) => ((total * weights[b]!) % W) - ((total * weights[a]!) % W) || a - b);
  for (const i of idx) if (left-- > 0) shares[i]!++;
  return shares;
}

describe('splitBill', () => {
  const cases: Array<[number, number[], number[]]> = [
    [100, [1, 1, 1], [34, 33, 33]],
    [101, [1, 1], [51, 50]],
    [-100, [1, 1, 1], [-34, -33, -33]],
    [-101, [1, 1], [-51, -50]],
    [10, [1, 2, 3, 4], [1, 2, 3, 4]],
    [100, [1, 0, 1], [50, 0, 50]],
    [1, [1, 1, 1], [1, 0, 0]],
    [2, [1, 1, 1], [1, 1, 0]],
    [-2, [1, 1, 1], [-1, -1, 0]],
    [100, [2, 1], [67, 33]],
    [-100, [2, 1], [-67, -33]],
    [5, [1, 3], [1, 4]],
    [10, [3, 3, 1], [4, 4, 2]],
    [-10, [3, 3, 1], [-4, -4, -2]],
    [1, [0, 1, 1], [0, 1, 0]],
    [7, [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 0]],
    [0, [1, 2], [0, 0]],
    [100, [0, 0, 5], [0, 0, 100]],
    [999, [5], [999]],
  ];
  for (const [total, weights, expected] of cases) {
    test(`splitBill(${total}, [${weights}])`, async () => {
      const { splitBill } = await load('split.ts');
      expect(norm(splitBill(total, weights))).toEqual(expected);
    });
  }

  test('matches largest-remainder allocation on many inputs', async () => {
    const { splitBill } = await load('split.ts');
    const weightSets = [
      [1, 1, 1],
      [1, 2],
      [3, 3, 1],
      [2, 5, 0, 7],
      [1, 1, 1, 1, 1, 1],
      [10, 3, 3],
      [0, 4],
      [9, 1, 1, 1],
    ];
    for (const weights of weightSets) {
      for (let total = -137; total <= 137; total += 1) {
        const shares = norm(splitBill(total, weights));
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(shares).toEqual(oracle(total, weights));
        expect(norm(splitBill(-total, weights))).toEqual(norm(shares.map((s) => -s)));
      }
    }
  });

  test('does not mutate the weights', async () => {
    const { splitBill } = await load('split.ts');
    const weights = [3, 1, 2];
    splitBill(100, weights);
    expect(weights).toEqual([3, 1, 2]);
  });

  test('rejects unusable input with RangeError', async () => {
    const { splitBill } = await load('split.ts');
    expect(() => splitBill(100, [])).toThrow(RangeError);
    expect(() => splitBill(100, [0, 0])).toThrow(RangeError);
    expect(() => splitBill(0, [0])).toThrow(RangeError);
    expect(() => splitBill(100, [-1, 2])).toThrow(RangeError);
    expect(() => splitBill(100, [1.5, 1])).toThrow(RangeError);
    expect(() => splitBill(100, [Number.NaN, 1])).toThrow(RangeError);
    expect(() => splitBill(10.5, [1, 1])).toThrow(RangeError);
  });

  test('splitEvenly', async () => {
    const { splitEvenly } = await load('split.ts');
    expect(norm(splitEvenly(100, 3))).toEqual([34, 33, 33]);
    expect(norm(splitEvenly(-100, 3))).toEqual([-34, -33, -33]);
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  test('positive amounts are unchanged', async () => {
    const { formatMoney } = await load('money.ts');
    expect(formatMoney(1234)).toBe('€12.34');
    expect(formatMoney(5)).toBe('€0.05');
    expect(formatMoney(0)).toBe('€0.00');
    expect(formatMoney(100000, 'USD')).toBe('$1000.00');
    expect(formatMoney(250, 'CHF')).toBe('CHF 2.50');
  });

  test('negative amounts put the sign first', async () => {
    const { formatMoney } = await load('money.ts');
    expect(formatMoney(-5)).toBe('-€0.05');
    expect(formatMoney(-50)).toBe('-€0.50');
    expect(formatMoney(-105)).toBe('-€1.05');
    expect(formatMoney(-100000, 'USD')).toBe('-$1000.00');
    expect(formatMoney(-250, 'CHF')).toBe('-CHF 2.50');
  });
});

describe('bill', () => {
  test('settle adds up for awkward bills and refunds', async () => {
    const { settle } = await load('bill.ts');
    const diners = [
      { name: 'Ana', weight: 1 },
      { name: 'Ben', weight: 1 },
    ];
    const refund = settle(-101, diners);
    expect(refund.totalCents).toBe(-101);
    expect(refund.shares.map((s: { cents: number }) => s.cents)).toEqual([-51, -50]);
    expect(settle(101, diners).totalCents).toBe(101);
  });

  test('describeSplit', async () => {
    const { describeSplit } = await load('bill.ts');
    const three = ['Ana', 'Ben', 'Cem'].map((name) => ({ name, weight: 1 }));
    expect(describeSplit(100, three)).toBe('Ana: €0.34\nBen: €0.33\nCem: €0.33\nTotal: €1.00');
    const weighted = [
      { name: 'Ana', weight: 2 },
      { name: 'Ben', weight: 1 },
      { name: 'Cem', weight: 1 },
    ];
    expect(describeSplit(-1001, weighted)).toBe(
      'Ana: -€5.01\nBen: -€2.50\nCem: -€2.50\nTotal: -€10.01',
    );
  });
});

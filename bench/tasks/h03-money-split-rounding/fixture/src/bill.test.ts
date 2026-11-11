import { expect, test } from 'bun:test';
import { describeSplit, settle } from './bill.ts';

const diners = [
  { name: 'Ana', weight: 2 },
  { name: 'Ben', weight: 1 },
  { name: 'Cem', weight: 1 },
];

test('settles a bill', () => {
  expect(settle(8000, diners)).toEqual({
    shares: [
      { name: 'Ana', cents: 4000 },
      { name: 'Ben', cents: 2000 },
      { name: 'Cem', cents: 2000 },
    ],
    totalCents: 8000,
  });
});

test('describes a split', () => {
  expect(describeSplit(4000, diners)).toBe('Ana: €20.00\nBen: €10.00\nCem: €10.00\nTotal: €40.00');
});

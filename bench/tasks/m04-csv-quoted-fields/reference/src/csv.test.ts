import { expect, test } from 'bun:test';
import { parseCsv, parseCsvLine } from './csv.ts';

test('splits plain fields', () => {
  expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
});

test('quoted fields may hold commas', () => {
  expect(parseCsvLine('Grace,grace@navy.mil,"Navy, US"')).toEqual([
    'Grace',
    'grace@navy.mil',
    'Navy, US',
  ]);
});

test('doubled quotes are one literal quote', () => {
  expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  expect(parseCsvLine('"",""')).toEqual(['', '']);
});

test('parses records with a header', () => {
  expect(parseCsv('x,y\n1,2\n\n3,4\n')).toEqual([
    { x: '1', y: '2' },
    { x: '3', y: '4' },
  ]);
});

import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const load = async () => (await import(join(dir, 'src/csv.ts'))).parseCsvLine;

test('plain fields are unchanged', async () => {
  const parseCsvLine = await load();
  expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
  expect(parseCsvLine('')).toEqual(['']);
  expect(parseCsvLine(' a , b ')).toEqual([' a ', ' b ']);
});

test('quoted fields keep commas', async () => {
  const parseCsvLine = await load();
  expect(parseCsvLine('Grace,grace@navy.mil,"Navy, US"')).toEqual([
    'Grace',
    'grace@navy.mil',
    'Navy, US',
  ]);
  expect(parseCsvLine('"a,b,c"')).toEqual(['a,b,c']);
  expect(parseCsvLine('",",x,","')).toEqual([',', 'x', ',']);
});

test('doubled quotes become one quote', async () => {
  const parseCsvLine = await load();
  expect(parseCsvLine('"say ""hi"""')).toEqual(['say "hi"']);
  expect(parseCsvLine('1,"""quoted"", and comma",3')).toEqual(['1', '"quoted", and comma', '3']);
  expect(parseCsvLine('""""')).toEqual(['"']);
});

test('empty quoted fields', async () => {
  const parseCsvLine = await load();
  expect(parseCsvLine('""')).toEqual(['']);
  expect(parseCsvLine('"",x,""')).toEqual(['', 'x', '']);
  expect(parseCsvLine('a,""')).toEqual(['a', '']);
  expect(parseCsvLine('"x",')).toEqual(['x', '']);
});

test('contacts import handles quoted companies', async () => {
  const { importContacts } = await import(join(dir, 'src/contacts.ts'));
  const csv = 'name,email,company\n"Hopper, Grace",grace@navy.mil,"Navy, US"\n';
  expect(importContacts(csv)).toEqual([
    { name: 'Hopper, Grace', email: 'grace@navy.mil', company: 'Navy, US' },
  ]);
});

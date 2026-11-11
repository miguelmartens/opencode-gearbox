import { expect, test } from 'bun:test';
import { importContacts } from './contacts.ts';

test('imports contacts with emails', () => {
  const csv = 'name,email,company\nAda,ADA@example.com,Analytical\nNo Mail,,Acme\n';
  expect(importContacts(csv)).toEqual([
    { name: 'Ada', email: 'ada@example.com', company: 'Analytical' },
  ]);
});

import { parseCsv } from './csv.ts';

export type Contact = { name: string; email: string; company: string };

/** Contacts from an export with `name,email,company` columns. Rows without an email are dropped. */
export function importContacts(csv: string): Contact[] {
  return parseCsv(csv)
    .map((r) => ({
      name: r.name ?? '',
      email: (r.email ?? '').toLowerCase(),
      company: r.company ?? '',
    }))
    .filter((c) => c.email.includes('@'));
}

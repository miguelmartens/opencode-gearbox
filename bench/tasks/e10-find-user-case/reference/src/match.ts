function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when two email addresses refer to the same mailbox. */
export function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

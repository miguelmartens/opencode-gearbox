const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the normalised address, or throws when it is not an email address. */
export function validateEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`Invaild email: ${input}`);
  return email;
}

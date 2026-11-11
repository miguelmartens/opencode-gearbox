import { validateEmail } from './email.ts';

export type SignupResult = { ok: true; email: string } | { ok: false; error: string };

export function signup(input: string): SignupResult {
  try {
    return { ok: true, email: validateEmail(input) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

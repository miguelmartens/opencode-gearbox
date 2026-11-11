export type Config = { port: number; debug: boolean };

export class ConfigError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

const TRUE = ['1', 'true', 'yes'];
const FALSE = ['0', 'false', 'no', ''];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 3000;
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535))
    throw new ConfigError('PORT', `expected an integer from 1 to 65535, got "${raw}"`);
  return port;
}

function parseBool(name: string, raw: string | undefined): boolean {
  const value = (raw ?? '').toLowerCase();
  if (TRUE.includes(value)) return true;
  if (FALSE.includes(value)) return false;
  throw new ConfigError(name, `expected 1/true/yes or 0/false/no, got "${raw}"`);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return { port: parsePort(env.PORT), debug: parseBool('DEBUG', env.DEBUG) };
}

import type { Config } from './config.ts';

export type Route = { method: 'GET' | 'POST'; path: string };

export const ROUTES: Route[] = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/status' },
  { method: 'POST', path: '/reload' },
];

/** One-line description of where the service listens. */
export function describeServer(config: Pick<Config, 'port'>): string {
  return `listening on :${config.port} (${ROUTES.length} routes)`;
}

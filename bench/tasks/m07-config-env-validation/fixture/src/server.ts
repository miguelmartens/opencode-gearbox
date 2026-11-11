export type Route = { method: 'GET' | 'POST'; path: string };

export const ROUTES: Route[] = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/status' },
  { method: 'POST', path: '/reload' },
];

/** One-line description of where the service listens. */
export function describeServer(): string {
  const port = parseInt(process.env.PORT || '8080');
  return `listening on :${port} (${ROUTES.length} routes)`;
}

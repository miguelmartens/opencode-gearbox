// Benchmark observer: a scratch plugin the runner loads into every arm's temporary project, never
// into a user config. It appends one JSON line per outgoing model request to `options.log`: the
// session, request kind, agent, model and the effort field of the request body as sent. That is
// what proves an arm really sends the effort it claims (bench/VERIFY.md).

import { appendFileSync } from 'node:fs';
import { Plugin } from '@opencode/plugin';

/** The effort-carrying fields of a request body, per provider protocol (docs/api-probe.md §7). */
export function effortOf(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (b.output_config !== undefined) out.output_config = b.output_config;
  if (b.thinking !== undefined) out.thinking = b.thinking;
  if (b.reasoning !== undefined) out.reasoning = b.reasoning;
  if (b.reasoning_effort !== undefined) out.reasoning_effort = b.reasoning_effort;
  return Object.keys(out).length > 0 ? out : null;
}

export default Plugin.define({
  id: 'gearbox-bench-observer',
  async setup(ctx) {
    const log = (ctx.options as { log?: unknown }).log;
    if (typeof log !== 'string') return;
    await ctx.session.hook('http.request', async (event) => {
      let body: unknown = null;
      try {
        body = await event.request.clone().json();
      } catch {
        body = null;
      }
      const line = {
        t: Date.now(),
        sessionID: event.sessionID,
        kind: event.kind,
        agent: event.agent,
        model: event.model,
        effort: effortOf(body),
      };
      appendFileSync(log, `${JSON.stringify(line)}\n`);
    });
    // The provider's own usage numbers, read from a copy of the response stream without
    // awaiting it, to cross-check OpenCode's per-step token counts.
    await ctx.session.hook('http.response', async (event) => {
      const started = Date.now();
      const copy = event.response.clone();
      void copy
        .text()
        .then((text) => {
          const usage = usageOf(text);
          if (!usage) return;
          const line = {
            t: started,
            sessionID: event.sessionID,
            kind: event.kind,
            agent: event.agent,
            model: event.model,
            usage,
          };
          appendFileSync(log, `${JSON.stringify(line)}\n`);
        })
        .catch(() => undefined);
    });
  },
});

/**
 * The provider usage objects in a response body (JSON or server-sent events), merged in order:
 * Anthropic sends input counts in `message_start` and output counts in `message_delta`.
 */
export function usageOf(text: string): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  let found = false;
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    const v = value as Record<string, unknown>;
    if (typeof v.usage === 'object' && v.usage !== null) {
      Object.assign(merged, v.usage);
      found = true;
    }
    for (const key of ['message', 'response']) visit(v[key]);
  };
  for (const raw of text.split('\n')) {
    const line = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      visit(JSON.parse(line));
    } catch {
      // not JSON
    }
  }
  return found ? merged : null;
}

// A private `opencode serve` per task run, isolated from the user's global config, driven through
// `@opencode/client` (test/e2e/CHECKLIST.md). `opencode run` cannot run plugin commands, and the
// runner needs `/gearbox settings`, the bus events and several turns in one session.

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { OpenCode } from '@opencode/client';
import type { OpenCodeClient } from '@opencode/client';

export type Server = {
  url: string;
  client: OpenCodeClient;
  /** Server stdout and stderr, for error reports. */
  log: () => string;
  stop: () => Promise<void>;
};

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Environment that keeps the user's own setup out of the run: an empty config home (no global
 * `opencode.jsonc`, plugins, agents or AGENTS.md) and no Claude Code instructions or skills.
 * Credentials and the session database stay in the normal data directory; V2 keeps provider
 * credentials there, so a private data directory would lose them.
 */
export function isolatedEnv(root: string, configFile: string, password: string) {
  const xdg = join(root, 'xdg-config');
  mkdirSync(xdg, { recursive: true });
  return {
    ...process.env,
    XDG_CONFIG_HOME: xdg,
    OPENCODE_CONFIG: configFile,
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_SERVER_PASSWORD: password,
  };
}

export async function startServer(opts: {
  cwd: string;
  root: string;
  configFile: string;
  readyTimeoutMs?: number;
}): Promise<Server> {
  const port = await freePort();
  const password = randomBytes(18).toString('base64url');
  const proc = Bun.spawn(['opencode', 'serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: opts.cwd,
    env: isolatedEnv(opts.root, opts.configFile, password),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) output = (output + decoder.decode(chunk)).slice(-20_000);
  };
  void drain(proc.stdout);
  void drain(proc.stderr);

  const url = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const client = OpenCode.make({ baseUrl: url, headers: { authorization: auth } });
  const stop = async () => {
    if (proc.exitCode !== null) return;
    proc.kill('SIGTERM');
    const exited = await Promise.race([
      proc.exited.then(() => true),
      Bun.sleep(5000).then(() => false),
    ]);
    if (!exited) proc.kill('SIGKILL');
  };

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 30_000);
  for (;;) {
    try {
      await client.server.info();
      break;
    } catch (error) {
      if (proc.exitCode !== null || Date.now() > deadline) {
        await stop();
        throw new Error(`opencode serve did not start: ${String(error)}\n${output}`);
      }
      await Bun.sleep(200);
    }
  }
  return { url, client, log: () => output, stop };
}

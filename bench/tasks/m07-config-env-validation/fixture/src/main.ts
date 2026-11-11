import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';
import type { Write } from './logger.ts';
import { describeServer } from './server.ts';

/** Starts the service and returns its config. */
export function start(
  env: Record<string, string | undefined> = process.env,
  write: Write = console.log,
) {
  const config = loadConfig(env);
  const log = createLogger('status', write);
  log.debug(`config ${JSON.stringify(config)}`);
  log.info(describeServer());
  return config;
}

import type { Config } from './config.ts';

export type Write = (line: string) => void;

export type Logger = {
  info(message: string): void;
  debug(message: string): void;
};

/** A logger that prefixes lines with `[name]`. Debug lines only appear when `config.debug` is on. */
export function createLogger(
  name: string,
  config: Pick<Config, 'debug'>,
  write: Write = console.log,
): Logger {
  return {
    info: (message) => write(`[${name}] ${message}`),
    debug: (message) => {
      if (config.debug) write(`[${name}] debug: ${message}`);
    },
  };
}

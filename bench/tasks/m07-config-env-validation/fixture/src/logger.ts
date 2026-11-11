export type Write = (line: string) => void;

export type Logger = {
  info(message: string): void;
  debug(message: string): void;
};

/** A logger that prefixes lines with `[name]`. Debug lines only appear when DEBUG=1. */
export function createLogger(name: string, write: Write = console.log): Logger {
  const verbose = process.env.DEBUG === '1';
  return {
    info: (message) => write(`[${name}] ${message}`),
    debug: (message) => {
      if (verbose) write(`[${name}] debug: ${message}`);
    },
  };
}

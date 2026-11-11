export type Command = { command: 'help' } | { command: 'run'; file: string };

/** Parses the arguments after the program name. */
export function parseArgs(argv: string[]): Command {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') return { command: 'help' };
  if (argv[0] === 'run' && argv[1]) return { command: 'run', file: argv[1] };
  throw new Error(`Unknown arguments: ${argv.join(' ')}`);
}

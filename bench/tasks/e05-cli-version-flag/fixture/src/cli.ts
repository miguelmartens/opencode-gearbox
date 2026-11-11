import { parseArgs } from './args.ts';

const USAGE = `Usage: notes <command>

Commands:
  run <file>   Render a notes file
  --help, -h   Show this help`;

/** Runs the CLI and returns what it prints. */
export function main(argv: string[]): string {
  const cmd = parseArgs(argv);
  switch (cmd.command) {
    case 'help':
      return USAGE;
    case 'run':
      return `Rendering ${cmd.file}`;
  }
}

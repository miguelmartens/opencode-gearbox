import { parseArgs } from './args.ts';
import { VERSION } from './version.ts';

const USAGE = `Usage: notes <command>

Commands:
  run <file>      Render a notes file
  --help, -h      Show this help
  --version, -v   Show the version`;

/** Runs the CLI and returns what it prints. */
export function main(argv: string[]): string {
  const cmd = parseArgs(argv);
  switch (cmd.command) {
    case 'help':
      return USAGE;
    case 'version':
      return VERSION;
    case 'run':
      return `Rendering ${cmd.file}`;
  }
}

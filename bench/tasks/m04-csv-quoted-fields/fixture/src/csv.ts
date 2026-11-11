/** Splits one CSV line into its fields. */
export function parseCsvLine(line: string): string[] {
  return line.split(',');
}

/** Parses CSV text with a header row into one record per data row. Blank lines are skipped. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = fields[i] ?? '';
    });
    return record;
  });
}

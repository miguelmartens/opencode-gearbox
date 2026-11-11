/** Splits one CSV line into its fields. Supports quoted fields with commas and `""` escapes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  fields.push(field);
  return fields;
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

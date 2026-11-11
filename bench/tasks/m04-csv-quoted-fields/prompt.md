Importing contacts breaks when a field contains a comma. For example the line

```
Grace,grace@navy.mil,"Navy, US"
```

ends up with company `"Navy` and a stray extra column. `parseCsvLine` in `src/csv.ts` just does `split(',')`.

Fix `parseCsvLine(line: string): string[]` to follow standard CSV quoting:

- A field wrapped in double quotes may contain commas; the surrounding quotes are not part of the value.
- Inside a quoted field, `""` stands for one literal `"`.
- `""` as a whole field is an empty string, and empty fields (including a trailing one) are kept.
- Unquoted fields are returned as-is, without trimming spaces.

Add tests for the quoted cases.

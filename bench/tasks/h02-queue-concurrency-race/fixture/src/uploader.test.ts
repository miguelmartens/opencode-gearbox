import { expect, test } from 'bun:test';
import { uploadAll } from './uploader.ts';

test('uploads every file', async () => {
  const seen: string[] = [];
  const report = await uploadAll(['a.txt', 'b.txt'], async (name) => {
    seen.push(name);
  });
  expect(seen.sort()).toEqual(['a.txt', 'b.txt']);
  expect(report).toEqual({ uploaded: ['a.txt', 'b.txt'], failed: [] });
});

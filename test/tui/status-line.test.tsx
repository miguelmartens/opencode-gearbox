/** @jsxImportSource @opentui/solid */
import { expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { StatusLine } from '../../src/tui/index.tsx';

test('colors each level segment', async () => {
  const t = await testRender(
    () => (
      <StatusLine
        segments={[{ text: '⚙ ' }, { text: 'high', fg: '#B69CFF' }, { text: ' · Auto' }]}
      />
    ),
    { width: 30, height: 1 },
  );
  await t.renderOnce();
  const span = t.captureSpans().lines[0]!.spans.find((s) => s.text.includes('high'));
  expect(Array.from(span!.fg.buffer.slice(0, 3))).toEqual([0xb6, 0x9c, 0xff]);
});

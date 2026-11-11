// A small monoline stroke font, so chart labels are paths, not `<text>`: GitHub shows README SVGs
// as images without fonts (assets/brand/source/generate.py outlines its text for the same reason).
// Glyphs are polylines on a 4-unit-wide grid: ascender at y = 0, x-height at 3, baseline at 7,
// descender at 9. Upper case is drawn as lower case.

type Glyph = number[][][];

const bowlRight = [
  [4, 4],
  [3, 3],
  [1, 3],
  [0, 4],
  [0, 6],
  [1, 7],
  [3, 7],
  [4, 6],
];
const bowlLeft = [
  [0, 4],
  [1, 3],
  [3, 3],
  [4, 4],
  [4, 6],
  [3, 7],
  [1, 7],
  [0, 6],
];
const dot = (x: number, y: number) => [
  [x, y],
  [x, y + 0.15],
];

export const GLYPHS: Record<string, Glyph> = {
  a: [
    [
      [4, 3],
      [4, 7],
    ],
    bowlRight,
  ],
  b: [
    [
      [0, 0],
      [0, 7],
    ],
    bowlLeft,
  ],
  c: [bowlRight],
  d: [
    [
      [4, 0],
      [4, 7],
    ],
    bowlRight,
  ],
  e: [
    [
      [0, 5],
      [4, 5],
      [4, 4],
      [3, 3],
      [1, 3],
      [0, 4],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6.4],
    ],
  ],
  f: [
    [
      [3.5, 0],
      [2.5, 0],
      [1.5, 1],
      [1.5, 7],
    ],
    [
      [0, 3],
      [3.5, 3],
    ],
  ],
  g: [
    [
      [4, 3],
      [4, 8],
      [3, 9],
      [1, 9],
      [0, 8.4],
    ],
    bowlRight,
  ],
  h: [
    [
      [0, 0],
      [0, 7],
    ],
    [
      [0, 4],
      [1, 3],
      [3, 3],
      [4, 4],
      [4, 7],
    ],
  ],
  i: [
    [
      [2, 3],
      [2, 7],
    ],
    dot(2, 1),
  ],
  j: [
    [
      [2.5, 3],
      [2.5, 8],
      [1.5, 9],
      [0.5, 9],
    ],
    dot(2.5, 1),
  ],
  k: [
    [
      [0, 0],
      [0, 7],
    ],
    [
      [4, 3],
      [0, 5.6],
    ],
    [
      [1.6, 4.6],
      [4, 7],
    ],
  ],
  l: [
    [
      [1.5, 0],
      [1.5, 6],
      [2.5, 7],
      [3, 7],
    ],
  ],
  m: [
    [
      [0, 3],
      [0, 7],
    ],
    [
      [0, 4],
      [1, 3],
      [2, 4],
      [2, 7],
    ],
    [
      [2, 4],
      [3, 3],
      [4, 4],
      [4, 7],
    ],
  ],
  n: [
    [
      [0, 3],
      [0, 7],
    ],
    [
      [0, 4],
      [1, 3],
      [3, 3],
      [4, 4],
      [4, 7],
    ],
  ],
  o: [[...bowlLeft, [0, 4]]],
  p: [
    [
      [0, 3],
      [0, 9],
    ],
    bowlLeft,
  ],
  q: [
    [
      [4, 3],
      [4, 9],
    ],
    bowlRight,
  ],
  r: [
    [
      [0, 3],
      [0, 7],
    ],
    [
      [0, 5],
      [1.2, 3.5],
      [2.2, 3],
      [3.5, 3],
    ],
  ],
  s: [
    [
      [4, 3.6],
      [3, 3],
      [1, 3],
      [0, 3.8],
      [1, 5],
      [3, 5],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6.4],
    ],
  ],
  t: [
    [
      [1.5, 1],
      [1.5, 6],
      [2.5, 7],
      [3.5, 7],
    ],
    [
      [0, 3],
      [3.5, 3],
    ],
  ],
  u: [
    [
      [0, 3],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
    ],
    [
      [4, 3],
      [4, 7],
    ],
  ],
  v: [
    [
      [0, 3],
      [2, 7],
      [4, 3],
    ],
  ],
  w: [
    [
      [0, 3],
      [1, 7],
      [2, 4.5],
      [3, 7],
      [4, 3],
    ],
  ],
  x: [
    [
      [0, 3],
      [4, 7],
    ],
    [
      [4, 3],
      [0, 7],
    ],
  ],
  y: [
    [
      [0, 3],
      [2, 7],
    ],
    [
      [4, 3],
      [1.5, 9],
    ],
  ],
  z: [
    [
      [0, 3],
      [4, 3],
      [0, 7],
      [4, 7],
    ],
  ],
  '0': [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6],
      [0, 1],
      [1, 0],
    ],
  ],
  '1': [
    [
      [1, 1.2],
      [2.5, 0],
      [2.5, 7],
    ],
    [
      [1, 7],
      [4, 7],
    ],
  ],
  '2': [
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [0, 7],
      [4, 7],
    ],
  ],
  '3': [
    [
      [0, 0.6],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [3, 3.5],
      [1.5, 3.5],
    ],
    [
      [3, 3.5],
      [4, 4.5],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6.4],
    ],
  ],
  '4': [
    [
      [3, 7],
      [3, 0],
      [0, 5],
      [4, 5],
    ],
  ],
  '5': [
    [
      [4, 0],
      [0.5, 0],
      [0, 3.3],
      [3, 3],
      [4, 4],
      [4, 6],
      [3, 7],
      [1, 7],
      [0, 6.4],
    ],
  ],
  '6': [
    [
      [3.5, 0],
      [2, 0],
      [0, 2.5],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 4.5],
      [3, 3.5],
      [1, 3.5],
      [0, 4.5],
    ],
  ],
  '7': [
    [
      [0, 0],
      [4, 0],
      [1.5, 7],
    ],
  ],
  '8': [
    [
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2.5],
      [3, 3.5],
      [1, 3.5],
      [0, 2.5],
      [0, 1],
      [1, 0],
    ],
    [
      [1, 3.5],
      [0, 4.5],
      [0, 6],
      [1, 7],
      [3, 7],
      [4, 6],
      [4, 4.5],
      [3, 3.5],
    ],
  ],
  '9': [
    [
      [4, 2.5],
      [3, 3.5],
      [1, 3.5],
      [0, 2.5],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 4.5],
      [2, 7],
      [0.5, 7],
    ],
  ],
  '%': [
    [
      [0, 7],
      [4, 0],
    ],
    [
      [0.4, 0],
      [1.4, 0],
      [1.4, 1.6],
      [0.4, 1.6],
      [0.4, 0],
    ],
    [
      [2.6, 5.4],
      [3.6, 5.4],
      [3.6, 7],
      [2.6, 7],
      [2.6, 5.4],
    ],
  ],
  $: [
    [
      [4, 1.2],
      [3, 0.6],
      [1, 0.6],
      [0, 1.5],
      [0, 2.6],
      [1, 3.5],
      [3, 3.5],
      [4, 4.4],
      [4, 5.5],
      [3, 6.4],
      [1, 6.4],
      [0, 5.8],
    ],
    [
      [2, -0.6],
      [2, 7.6],
    ],
  ],
  '.': [dot(2, 6.85)],
  ',': [
    [
      [2, 6.6],
      [1.4, 8.2],
    ],
  ],
  '-': [
    [
      [0.5, 4.5],
      [3.5, 4.5],
    ],
  ],
  '−': [
    [
      [0.5, 4.5],
      [3.5, 4.5],
    ],
  ],
  '+': [
    [
      [0.5, 4.5],
      [3.5, 4.5],
    ],
    [
      [2, 3],
      [2, 6],
    ],
  ],
  '·': [dot(2, 4.4)],
  ':': [dot(2, 3.5), dot(2, 6.85)],
  '×': [
    [
      [0.8, 3.3],
      [3.2, 5.7],
    ],
    [
      [3.2, 3.3],
      [0.8, 5.7],
    ],
  ],
  '/': [
    [
      [0.5, 8],
      [3.5, -0.5],
    ],
  ],
  '(': [
    [
      [3, -0.5],
      [2, 0.8],
      [1.5, 3],
      [1.5, 5],
      [2, 7.2],
      [3, 8.5],
    ],
  ],
  ')': [
    [
      [1, -0.5],
      [2, 0.8],
      [2.5, 3],
      [2.5, 5],
      [2, 7.2],
      [1, 8.5],
    ],
  ],
  '→': [
    [
      [0, 4.5],
      [4, 4.5],
    ],
    [
      [2.5, 3],
      [4, 4.5],
      [2.5, 6],
    ],
  ],
  '↑': [
    [
      [2, 7],
      [2, 1],
    ],
    [
      [0.5, 2.5],
      [2, 1],
      [3.5, 2.5],
    ],
  ],
  '←': [
    [
      [4, 4.5],
      [0, 4.5],
    ],
    [
      [1.5, 3],
      [0, 4.5],
      [1.5, 6],
    ],
  ],
  ' ': [],
};

const ADVANCE = 5.6;
/** Grid units from the ascender to the baseline. */
const CAP = 7;

const r = (v: number) => Math.round(v * 100) / 100;

/** Width of `text` at `size` (ascender-to-baseline height in px). */
export function textWidth(text: string, size: number): number {
  const u = size / CAP;
  return Math.max(0, [...text].length * ADVANCE - (ADVANCE - 4)) * u;
}

/**
 * Path data for `text`; `(x, y)` is the baseline at the anchor. Characters without a glyph keep
 * their advance and draw nothing.
 */
export function textPath(
  text: string,
  x: number,
  y: number,
  size: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  const u = size / CAP;
  const w = textWidth(text, size);
  let cx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const top = y - CAP * u;
  const parts: string[] = [];
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()] ?? [];
    for (const line of glyph)
      parts.push(
        line.map(([gx, gy], i) => `${i ? 'L' : 'M'}${r(cx + gx * u)} ${r(top + gy * u)}`).join(''),
      );
    cx += ADVANCE * u;
  }
  return parts.join('');
}

/** A stroked `<path>` for `text`; empty when nothing would be drawn. */
export function textSvg(
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight = 0.13,
): string {
  const d = textPath(text, x, y, size, anchor);
  if (!d) return '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${r(size * weight)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

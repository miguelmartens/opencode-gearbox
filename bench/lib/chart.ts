// Scatter of tasks solved against cost per task, one marker per arm, with min–max bars over runs.
// Pure: summary in, SVG string out.

import type { ArmSummary, Summary } from './summary.ts';

export const LEVEL_COLORS: Record<string, string> = {
  low: '#8BE48B',
  medium: '#66C7FF',
  high: '#B69CFF',
  xhigh: '#FF9A3C',
  max: '#FF4F4F',
};

export type Theme = 'dark' | 'light';

const PALETTE = {
  dark: { bg: '#0C0C0D', border: '#EDECE6', grid: '#34343A', gridOpacity: 1, text: '#8C8C93' },
  light: { bg: '#F2F1EC', border: '#0C0C0D', grid: '#34343A', gridOpacity: 0.25, text: '#8C8C93' },
};

const GEARBOX_FILL = '#EDECE6';
const MUTE = '#8C8C93';

const W = 720;
const H = 440;
const PAD = { left: 74, right: 34, top: 52, bottom: 64 };

const r = (v: number) => Math.round(v * 100) / 100;

// GitHub shows README SVGs as images: web fonts never load, installed system fonts do.
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** Cap height and advance of a monospace font, as shares of its font size. */
const CAP = 0.7;
const ADVANCE = 0.6;

/** Estimated width of `text` whose cap height is `size` px; label placement uses it. */
function textWidth(text: string, size: number): number {
  return [...text].length * (size / CAP) * ADVANCE;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A `<text>` with cap height `size` px; `(x, y)` is the baseline at the anchor. */
function textSvg(
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  bold = false,
): string {
  const weight = bold ? ' font-weight="600"' : '';
  return `<text x="${r(x)}" y="${r(y)}" font-family="${FONT}" font-size="${r(size / CAP)}" fill="${color}" text-anchor="${anchor}"${weight}>${escapeXml(text)}</text>`;
}

/** A tick step of 1, 2 or 5 × 10ⁿ giving about `count` ticks up to `max`. */
export function niceStep(max: number, count = 5): number {
  if (!(max > 0)) return 1;
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

export function formatUSD(v: number): string {
  if (v === 0) return '$0';
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${Number(v.toPrecision(2))}`;
}

/** The short marker label of an arm. */
export function armTag(a: ArmSummary): string {
  if (a.id === 'auto') return 'gearbox';
  if (a.id === 'auto-effort') return 'effort only';
  return a.id;
}

function armColor(a: ArmSummary, border: string): string {
  if (a.id === 'auto') return border;
  if (a.id === 'auto-effort') return MUTE;
  return LEVEL_COLORS[a.id] ?? MUTE;
}

const labelRank = (a: ArmSummary) => (a.id === 'auto' ? 0 : a.id === 'auto-effort' ? 1 : 2);

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function renderChart(summary: Summary, theme: Theme): string {
  const p = PALETTE[theme];
  const arms = summary.arms;
  const plot = { x0: PAD.left, y0: PAD.top, x1: W - PAD.right, y1: H - PAD.bottom };

  const maxCost = Math.max(0, ...arms.map((a) => Math.max(a.costPerTask, a.costRange[1])));
  const xStep = niceStep(maxCost * 1.1 || 1, 5);
  const xMax = Math.ceil((maxCost * 1.1 || xStep) / xStep) * xStep;
  const minPass = Math.min(1, ...arms.map((a) => Math.min(a.passRate, a.passRange[0])));
  const yMin = Math.max(0, Math.floor((minPass * 100 - 5) / 10) * 10);
  const yStep = 100 - yMin > 50 ? 20 : 10;

  // Data sit inside the frame, so a marker at 100% or $0 does not sit on it.
  const IN = 20;
  const sx = (v: number) => plot.x0 + IN + (v / xMax) * (plot.x1 - plot.x0 - 2 * IN);
  const sy = (pct: number) =>
    plot.y1 - IN - ((pct - yMin) / (100 - yMin)) * (plot.y1 - plot.y0 - 2 * IN);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks solved vs cost per task for each setup">`,
  );
  out.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`);

  // Grid, then tick labels.
  const grid: string[] = [];
  const ticks: string[] = [];
  for (let i = 0; yMin + i * yStep <= 100; i++) {
    const v = yMin + i * yStep;
    const y = r(sy(v));
    grid.push(`M${plot.x0} ${y}H${plot.x1}`);
    ticks.push(textSvg(`${v}%`, plot.x0 - 10, y + 4, 9, p.text, 'end'));
  }
  for (let i = 0; i * xStep <= xMax * (1 + 1e-9); i++) {
    const v = Number((i * xStep).toPrecision(6));
    const x = r(sx(v));
    grid.push(`M${x} ${plot.y0}V${plot.y1}`);
    ticks.push(textSvg(formatUSD(v), x, plot.y1 + 20, 9, p.text, 'middle'));
  }
  out.push(
    `<path d="${grid.join('')}" stroke="${p.grid}" stroke-opacity="${p.gridOpacity}" stroke-width="1" fill="none"/>`,
    ...ticks,
  );
  out.push(
    `<rect x="${plot.x0}" y="${plot.y0}" width="${plot.x1 - plot.x0}" height="${plot.y1 - plot.y0}" fill="none" stroke="${p.border}" stroke-width="1.5"/>`,
  );

  // Axis titles.
  out.push(textSvg('cost per task (usd)', (plot.x0 + plot.x1) / 2, H - 16, 10, p.text, 'middle'));
  out.push(textSvg('tasks solved', plot.x0, plot.y0 - 18, 10, p.text, 'start'));
  out.push(textSvg('↑ more solved · ← cheaper', plot.x1, plot.y0 - 18, 9, p.text, 'end'));

  // Bars, then markers (Gearbox on top), then labels with leader lines.
  const bars: string[] = [];
  const markers: string[] = [];
  const labels: string[] = [];
  const pos = (a: ArmSummary) => ({ x: r(sx(a.costPerTask)), y: r(sy(a.passRate * 100)) });
  const fixedFirst = [...arms].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'gearbox' ? 1 : -1,
  );
  const taken: Box[] = arms.map((a) => {
    const { x, y } = pos(a);
    return { x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 9 };
  });
  for (const a of fixedFirst) {
    const { x, y } = pos(a);
    const color = armColor(a, p.border);
    const xa = r(sx(a.costRange[0]));
    const xb = r(sx(a.costRange[1]));
    const ya = r(sy(a.passRange[1] * 100));
    const yb = r(sy(a.passRange[0] * 100));
    bars.push(
      `<path d="M${xa} ${y}H${xb}M${xa} ${y - 4}V${y + 4}M${xb} ${y - 4}V${y + 4}M${x} ${ya}V${yb}M${x - 4} ${ya}H${x + 4}M${x - 4} ${yb}H${x + 4}" stroke="${color}" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>`,
    );
    if (a.id === 'auto')
      markers.push(
        `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${GEARBOX_FILL}" stroke="${p.border}" stroke-width="1.5"/>`,
      );
    else if (a.id === 'auto-effort')
      markers.push(
        `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="${p.bg}" stroke="${MUTE}" stroke-width="2"/>`,
      );
    else
      markers.push(
        `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="${p.bg}" stroke-width="1.5"/>`,
      );
  }

  // Labels: Gearbox first. Beside the marker when free, else moved up or down in steps with a
  // leader line; the first spot inside the frame that overlaps no marker or label wins.
  const labelOrder = [...arms].sort((a, b) => labelRank(a) - labelRank(b));
  for (const a of labelOrder) {
    const { x, y } = pos(a);
    const tag = armTag(a);
    const size = a.id === 'auto' ? 11 : 9.5;
    const w = textWidth(tag, size);
    let placed: { lx: number; ly: number; anchor: 'start' | 'end'; box: Box } | null = null;
    search: for (const dy of [0, -18, 18, -36, 36, -54, 54, -72, 72, -90, 90]) {
      for (const side of [1, -1]) {
        const lx = x + side * (dy === 0 ? 13 : 24);
        const ly = y + dy + size / 2;
        const anchor = side > 0 ? 'start' : 'end';
        const x0 = anchor === 'start' ? lx : lx - w;
        const box = { x0: x0 - 2, y0: ly - size - 2, x1: x0 + w + 2, y1: ly + 3 };
        const inside =
          box.x0 >= plot.x0 + 2 &&
          box.x1 <= plot.x1 - 2 &&
          box.y0 >= plot.y0 + 2 &&
          box.y1 <= plot.y1 - 2;
        if (inside && !taken.some((b) => overlaps(b, box))) {
          placed = { lx, ly, anchor, box };
          break search;
        }
      }
    }
    const fallback = { lx: x + 13, ly: y + size / 2, anchor: 'start' as const, box: taken[0] };
    const { lx, ly, anchor, box } = placed ?? fallback;
    if (placed) taken.push(box);
    const labelColor = a.kind === 'gearbox' ? p.border : p.text;
    if (Math.abs(ly - size / 2 - y) > 1) {
      const ex = anchor === 'start' ? lx - 3 : lx + 3;
      labels.push(
        `<path d="M${x} ${y}L${r(ex)} ${r(ly - size / 2)}" stroke="${p.text}" stroke-opacity="0.6" stroke-width="1" fill="none"/>`,
      );
    }
    labels.push(textSvg(tag, lx, ly, size, labelColor, anchor, a.id === 'auto'));
  }
  out.push(...bars, ...markers, ...labels);
  out.push('</svg>');
  return `${out.filter(Boolean).join('\n')}\n`;
}

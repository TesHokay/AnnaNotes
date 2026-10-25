import { isDarkPaper, TEMPLATE_SPACING } from './paper';
import type { CutePaperId, Page, PageTemplate, PaperStyle } from './types';

type Decor = 'none' | 'sakura' | 'hearts' | 'gingham';

export interface CutePaperDef {
  id: CutePaperId;
  name: string;
  description: string;
  template: PageTemplate;
  paperColor: string;
  lineColor: string;
  spacing: number;
  decor: Decor;
}

/** Cute Paper collection. Everything is parametric (vector), nothing is a bitmap. */
export const CUTE_PAPERS: readonly CutePaperDef[] = [
  { id: 'strawberry', name: 'Strawberry Milk', description: 'Нежно-розовая, в клетку', template: 'grid', paperColor: '#fdeef2', lineColor: '#e597ad', spacing: 18, decor: 'none' },
  { id: 'lavender', name: 'Lavender Dream', description: 'Светло-лавандовая, в линейку', template: 'lined', paperColor: '#f4effb', lineColor: '#a58fd4', spacing: 24, decor: 'none' },
  { id: 'vanilla', name: 'Vanilla Cream', description: 'Кремовая, в точку', template: 'dotted', paperColor: '#fff8e8', lineColor: '#c4a272', spacing: 18, decor: 'none' },
  { id: 'matcha', name: 'Matcha Notes', description: 'Мягкая зелёная, в клетку', template: 'grid', paperColor: '#eef5e9', lineColor: '#8db384', spacing: 18, decor: 'none' },
  { id: 'sakura', name: 'Cherry Blossom', description: 'Сакура по уголкам', template: 'lined', paperColor: '#fff8f9', lineColor: '#e6a2b4', spacing: 24, decor: 'sakura' },
  { id: 'hearts', name: 'Little Hearts', description: 'Сердечки вдоль краёв', template: 'dotted', paperColor: '#fffafb', lineColor: '#e2a0b2', spacing: 18, decor: 'hearts' },
  { id: 'gingham', name: 'Pink Gingham', description: 'Нежная розовая клетка', template: 'blank', paperColor: '#fff7f9', lineColor: '#f0afc2', spacing: 18, decor: 'gingham' },
  { id: 'beige', name: 'Cozy Beige', description: 'Тёплый бежевый, в линейку', template: 'lined', paperColor: '#f6ecdf', lineColor: '#b59b80', spacing: 24, decor: 'none' },
  { id: 'sky', name: 'Blue Sky', description: 'Светло-голубая, в клетку', template: 'grid', paperColor: '#edf5fd', lineColor: '#8cb4dc', spacing: 18, decor: 'none' },
  { id: 'moonlight', name: 'Moonlight', description: 'Тёмная, приглушённая сетка', template: 'grid', paperColor: '#25232f', lineColor: '#7d78a6', spacing: 18, decor: 'none' },
];

export const CUTE_BY_ID: Record<CutePaperId, CutePaperDef> = Object.fromEntries(CUTE_PAPERS.map((c) => [c.id, c])) as Record<CutePaperId, CutePaperDef>;

/** Pastel line colours offered for any template. */
export const LINE_COLORS = ['#3c5a8c', '#e597ad', '#a58fd4', '#8db384', '#8cb4dc', '#c4a272', '#b59b80', '#80666d'];

export const SPACING_RANGE = { min: 10, max: 40 } as const;

type PaperLike = Pick<Page, 'width' | 'height' | 'template' | 'paperColor' | 'style'>;

export interface Ruling {
  template: PageTemplate;
  spacing: number;
  color: string;
  /** Opacity of lines (dots get a little more). */
  alpha: number;
  /** Red margin line of classic lined paper. */
  margin: boolean;
}

export function cuteOf(page: Pick<PaperLike, 'style'>): CutePaperDef | null {
  const id = page.style?.cute;
  return id ? (CUTE_BY_ID[id] ?? null) : null;
}

export function resolveRuling(page: PaperLike): Ruling {
  const cute = cuteOf(page);
  const dark = isDarkPaper(page.paperColor);
  const base = page.template === 'blank' ? 18 : TEMPLATE_SPACING[page.template];
  const spacing = Math.min(SPACING_RANGE.max, Math.max(SPACING_RANGE.min, page.style?.spacing ?? cute?.spacing ?? base));
  const custom = page.style?.lineColor ?? cute?.lineColor;
  const color = custom ?? (dark ? '#ffffff' : '#3c5a8c');
  const alpha = custom ? (dark ? 0.38 : 0.5) : dark ? 0.16 : 0.22;
  return { template: page.template, spacing, color, alpha, margin: !cute && page.template === 'lined' };
}

export interface DecorShape {
  /** SVG path in page coordinates (points, y down). */
  d: string;
  fill: string;
  opacity: number;
  /** Drawn below the ruling (gingham bands) or above it (flowers, hearts). */
  layer: 'under' | 'over';
}

const f = (v: number) => v.toFixed(2);

function heartPath(cx: number, cy: number, s: number): string {
  // Cubic heart, width ≈ s, tip at the bottom.
  const h = s * 0.9;
  const top = cy - h * 0.32;
  return [
    `M${f(cx)} ${f(cy + h * 0.5)}`,
    `C${f(cx - s * 0.62)} ${f(cy + h * 0.05)} ${f(cx - s * 0.55)} ${f(top - h * 0.38)} ${f(cx)} ${f(top)}`,
    `C${f(cx + s * 0.55)} ${f(top - h * 0.38)} ${f(cx + s * 0.62)} ${f(cy + h * 0.05)} ${f(cx)} ${f(cy + h * 0.5)}Z`,
  ].join('');
}

/** Five rounded petals with the characteristic sakura notch. */
function sakuraPath(cx: number, cy: number, r: number, rot: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    const p = (ang: number, rad: number) => `${f(cx + Math.cos(ang) * rad)} ${f(cy + Math.sin(ang) * rad)}`;
    const w = 0.5;
    parts.push(`M${p(a, r * 0.12)}`);
    parts.push(`C${p(a - w, r * 0.55)} ${p(a - w * 0.55, r * 1.05)} ${p(a - 0.12, r)}`);
    parts.push(`L${p(a, r * 0.86)}`);
    parts.push(`L${p(a + 0.12, r)}`);
    parts.push(`C${p(a + w * 0.55, r * 1.05)} ${p(a + w, r * 0.55)} ${p(a, r * 0.12)}Z`);
  }
  return parts.join('');
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
}

const decorCache = new Map<string, DecorShape[]>();

/** Decorative layer of a page (empty for classic papers or when decorations are switched off). */
export function paperDecor(page: PaperLike): DecorShape[] {
  const cute = cuteOf(page);
  if (!cute || cute.decor === 'none' || page.style?.decor === false) return [];
  const ruling = resolveRuling(page);
  const key = `${cute.id}|${page.width}|${page.height}|${ruling.spacing}|${ruling.color}`;
  const hit = decorCache.get(key);
  if (hit) return hit;
  const { width: w, height: h } = page;
  const out: DecorShape[] = [];
  if (cute.decor === 'gingham') {
    // Woven look: translucent vertical and horizontal bands; where they cross the colour deepens.
    const s = ruling.spacing;
    const band = s / 2;
    const v: string[] = [];
    const hz: string[] = [];
    for (let x = 0; x < w; x += s) v.push(`M${f(x)} 0H${f(Math.min(w, x + band))}V${f(h)}H${f(x)}Z`);
    for (let y = 0; y < h; y += s) hz.push(`M0 ${f(y)}H${f(w)}V${f(Math.min(h, y + band))}H0Z`);
    out.push({ d: v.join(''), fill: ruling.color, opacity: 0.22, layer: 'under' });
    out.push({ d: hz.join(''), fill: ruling.color, opacity: 0.22, layer: 'under' });
  } else if (cute.decor === 'sakura') {
    const k = Math.min(w, h) / 595;
    const flowers: [number, number, number, number][] = [
      // top-left cluster
      [26, 30, 17, 0.2], [58, 20, 10, 1.1], [20, 66, 11, 0.7], [70, 52, 6, 0.4],
      // bottom-right cluster (mirrored)
      [w / k - 26, h / k - 30, 17, 0.9], [w / k - 60, h / k - 18, 10, 0.1], [w / k - 18, h / k - 68, 11, 1.4], [w / k - 72, h / k - 50, 6, 0.6],
    ];
    const petals: string[] = [];
    const centres: string[] = [];
    for (const [x, y, r, rot] of flowers) {
      petals.push(sakuraPath(x * k, y * k, r * k, rot));
      centres.push(circlePath(x * k, y * k, r * k * 0.18));
    }
    // a few loose petals drifting away from the corners
    const loose: string[] = [];
    for (const [x, y, r, rot] of [[96, 34, 4, 0.3], [40, 98, 3.5, 1.2], [w / k - 100, h / k - 36, 4, 2], [w / k - 40, h / k - 100, 3.5, 0.8]] as const) {
      loose.push(sakuraPath(x * k, y * k, r * k, rot));
    }
    out.push({ d: petals.join(''), fill: '#f7c3d0', opacity: 0.95, layer: 'over' });
    out.push({ d: loose.join(''), fill: '#f9d2dc', opacity: 0.9, layer: 'over' });
    out.push({ d: centres.join(''), fill: '#e38aa2', opacity: 0.9, layer: 'over' });
  } else if (cute.decor === 'hearts') {
    const s = 7;
    const step = 30;
    const a: string[] = [];
    const b: string[] = [];
    let i = 0;
    const n = Math.floor((w - 40) / step);
    const x0 = (w - n * step) / 2;
    for (let k = 0; k <= n; k++) {
      const x = x0 + k * step;
      (i++ % 2 ? b : a).push(heartPath(x, 14, s), heartPath(x, h - 14, s));
    }
    const m = Math.floor((h - 60) / step);
    const y0 = (h - m * step) / 2;
    for (let k = 1; k < m; k++) {
      const y = y0 + k * step;
      (i++ % 2 ? b : a).push(heartPath(12, y, s * 0.8), heartPath(w - 12, y, s * 0.8));
    }
    out.push({ d: a.join(''), fill: '#f2a9bc', opacity: 0.85, layer: 'over' });
    out.push({ d: b.join(''), fill: '#f8cdd8', opacity: 0.95, layer: 'over' });
  }
  if (decorCache.size > 40) decorCache.clear();
  decorCache.set(key, out);
  return out;
}

/** Page style for a cute paper (keeps user overrides of spacing/colour only when asked). */
export function cuteStyle(id: CutePaperId): PaperStyle {
  return { cute: id };
}

/** Stable key of everything that changes how the paper looks (cache invalidation). */
export function paperKey(page: Pick<Page, 'template' | 'paperColor' | 'style'>): string {
  const s = page.style;
  return `${page.template}|${page.paperColor}|${s?.cute ?? ''}|${s?.spacing ?? ''}|${s?.lineColor ?? ''}|${s?.decor === false ? 0 : 1}`;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

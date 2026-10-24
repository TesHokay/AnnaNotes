import type { Orientation, PageSetup, PaperSize } from './types';

/** Paper sizes in points (1/72 inch), portrait. */
export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; label: string }> = {
  A4: { width: 595.28, height: 841.89, label: 'A4' },
  A5: { width: 419.53, height: 595.28, label: 'A5' },
  Letter: { width: 612, height: 792, label: 'Letter' },
};

export function pageDimensions(size: PaperSize, orientation: Orientation): { width: number; height: number } {
  const s = PAPER_SIZES[size];
  return orientation === 'portrait' ? { width: s.width, height: s.height } : { width: s.height, height: s.width };
}

export const PAPER_COLORS = [
  { value: '#ffffff', label: 'Белая' },
  { value: '#fbf7ec', label: 'Кремовая' },
  { value: '#f3f4f6', label: 'Серая' },
  { value: '#eef6ff', label: 'Голубая' },
  { value: '#f0f7ee', label: 'Мятная' },
  { value: '#1f2329', label: 'Тёмная' },
];

export const COVER_COLORS = ['#f4a6c1', '#f7c6d9', '#e7b8e8', '#c9b8f2', '#b8d8f2', '#bfe8d4', '#f8dfa8', '#f6b8a8', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b', '#1f2937'];

export const DEFAULT_SETUP: PageSetup = {
  size: 'A4',
  orientation: 'portrait',
  template: 'lined',
  paperColor: '#ffffff',
};

/** Spacing of template lines in points. */
export const TEMPLATE_SPACING = { grid: 18, lined: 24, dotted: 18 } as const;

export function isDarkPaper(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m || !m[1]) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

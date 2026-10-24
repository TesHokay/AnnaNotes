import type { Vec } from '@/engine/geometry';

/** A run of text on a PDF page in page-local document coordinates. */
export interface TextRun {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  text: string;
}

export interface HighlightSegment {
  from: Vec;
  to: Vec;
  /** line height = highlight thickness */
  height: number;
}

/**
 * Snaps a roughly horizontal highlighter stroke to the text lines it covers. Runs that overlap
 * the stroke's vertical band are grouped into lines; each line yields one straight highlight
 * spanning the covered part of the line. Returns [] when the stroke does not cover text.
 */
export function snapHighlightToText(points: readonly Vec[], runs: readonly TextRun[], strokeWidth: number): HighlightSegment[] {
  if (points.length < 2 || runs.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const bandTop = minY - strokeWidth / 2;
  const bandBottom = maxY + strokeWidth / 2;
  const hits = runs.filter((r) => {
    const h = r.maxY - r.minY;
    if (h <= 0) return false;
    const overlapY = Math.min(r.maxY, bandBottom) - Math.max(r.minY, bandTop);
    const overlapX = Math.min(r.maxX, maxX) - Math.max(r.minX, minX);
    return overlapY >= h * 0.4 && overlapX > 0;
  });
  if (!hits.length) return [];
  // Group runs into lines by vertical centre.
  const lines: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (const r of hits.sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2)) {
    const c = (r.minY + r.maxY) / 2;
    const line = lines.find((l) => c >= l.minY && c <= l.maxY);
    if (line) {
      line.minX = Math.min(line.minX, r.minX);
      line.maxX = Math.max(line.maxX, r.maxX);
      line.minY = Math.min(line.minY, r.minY);
      line.maxY = Math.max(line.maxY, r.maxY);
    } else lines.push({ minX: r.minX, maxX: r.maxX, minY: r.minY, maxY: r.maxY });
  }
  const multi = lines.length > 1;
  return lines.map((l, i) => {
    // For multi-line highlights, inner lines span fully; the first starts at the stroke start, the last ends at the stroke end.
    const start = multi && i > 0 ? l.minX : Math.max(l.minX, minX);
    const end = multi && i < lines.length - 1 ? l.maxX : Math.min(l.maxX, maxX);
    const y = (l.minY + l.maxY) / 2;
    return { from: { x: start, y }, to: { x: Math.max(start + 1, end), y }, height: (l.maxY - l.minY) * 1.1 };
  });
}

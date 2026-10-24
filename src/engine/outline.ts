import type { PenStyle, StrokeElement, StrokePoint, StrokeTool } from '@/model/types';
import type { Vec } from './geometry';

export interface WidthProfile {
  /** Minimum width as a fraction of base width at zero pressure. */
  minRatio: number;
  /** Fraction of the stroke length over which start/end taper is applied (brush only). */
  taper: number;
}

export function widthProfile(tool: StrokeTool, style: PenStyle): WidthProfile {
  if (tool !== 'pen') return { minRatio: 1, taper: 0 };
  switch (style) {
    case 'fountain':
      return { minRatio: 0.3, taper: 0 };
    case 'ball':
      return { minRatio: 0.82, taper: 0 };
    case 'brush':
      return { minRatio: 0.08, taper: 0.12 };
  }
}

/** Per-point widths in document units. */
export function computeWidths(points: readonly StrokePoint[], baseWidth: number, profile: WidthProfile): number[] {
  const n = points.length;
  const widths = new Array<number>(n);
  let total = 0;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    cum[i] = total;
  }
  const taperLen = total * profile.taper;
  for (let i = 0; i < n; i++) {
    const p = points[i]!.pressure;
    let w = baseWidth * (profile.minRatio + (1 - profile.minRatio) * p);
    if (taperLen > 0) {
      const fromStart = cum[i]!;
      const fromEnd = total - cum[i]!;
      const t = Math.min(1, fromStart / taperLen, fromEnd / taperLen);
      w *= 0.35 + 0.65 * Math.sin((t * Math.PI) / 2);
    }
    widths[i] = Math.max(0.3, w);
  }
  return widths;
}

function capPoints(c: Vec, r: number, fromAngle: number, steps: number, out: Vec[]): void {
  // Half circle from `fromAngle`, decreasing angle (travels through the stroke direction).
  for (let s = 1; s < steps; s++) {
    const a = fromAngle - (Math.PI * s) / steps;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
}

/**
 * Builds a closed outline polygon around a variable-width polyline. The polygon is filled once,
 * so semi-transparent strokes do not darken where segments overlap.
 */
export function outlinePolygon(points: readonly Vec[], widths: readonly number[]): Vec[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1 || (n === 2 && points[0]!.x === points[1]!.x && points[0]!.y === points[1]!.y)) {
    const c = points[0]!;
    const r = widths[0]! / 2;
    const dot: Vec[] = [];
    for (let i = 0; i < 12; i++) dot.push({ x: c.x + Math.cos((i / 12) * Math.PI * 2) * r, y: c.y + Math.sin((i / 12) * Math.PI * 2) * r });
    return dot;
  }
  const left: Vec[] = [];
  const right: Vec[] = [];
  const normals: Vec[] = [];
  let lastDir: Vec = { x: 1, y: 0 };
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(n - 1, i + 1)]!;
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // Hairpin or duplicate points: fall back to the incoming segment direction.
      dx = lastDir.x;
      dy = lastDir.y;
      len = 1;
    }
    dx /= len;
    dy /= len;
    lastDir = { x: dx, y: dy };
    const nx = -dy;
    const ny = dx;
    normals.push({ x: nx, y: ny });
    const r = widths[i]! / 2;
    const p = points[i]!;
    left.push({ x: p.x + nx * r, y: p.y + ny * r });
    right.push({ x: p.x - nx * r, y: p.y - ny * r });
  }
  const out: Vec[] = [];
  for (const p of left) out.push(p);
  const endN = normals[n - 1]!;
  const endR = widths[n - 1]! / 2;
  capPoints(points[n - 1]!, endR, Math.atan2(endN.y, endN.x), Math.max(4, Math.min(10, Math.round(endR))), out);
  for (let i = n - 1; i >= 0; i--) out.push(right[i]!);
  const startN = normals[0]!;
  const startR = widths[0]! / 2;
  capPoints(points[0]!, startR, Math.atan2(startN.y, startN.x) + Math.PI, Math.max(4, Math.min(10, Math.round(startR))), out);
  return out;
}

export function strokeOutline(stroke: Pick<StrokeElement, 'points' | 'baseWidth' | 'tool' | 'penStyle'>): Vec[] {
  const widths = computeWidths(stroke.points, stroke.baseWidth, widthProfile(stroke.tool, stroke.penStyle));
  return outlinePolygon(stroke.points, widths);
}

/** Smooth closed path through polygon vertices using quadratic curves between midpoints. */
export function tracePolygon(ctx: CanvasRenderingContext2D | Path2D, poly: readonly Vec[]): void {
  const n = poly.length;
  if (n < 3) return;
  const first = poly[0]!;
  const last = poly[n - 1]!;
  ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
}

/** Same geometry as tracePolygon, expressed as an SVG path (used for vector PDF export). */
export function polygonToSvgPath(poly: readonly Vec[], precision = 2): string {
  const n = poly.length;
  if (n < 3) return '';
  const f = (v: number) => v.toFixed(precision);
  const first = poly[0]!;
  const last = poly[n - 1]!;
  const parts = [`M${f((first.x + last.x) / 2)} ${f((first.y + last.y) / 2)}`];
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    parts.push(`Q${f(p.x)} ${f(p.y)} ${f((p.x + q.x) / 2)} ${f((p.y + q.y) / 2)}`);
  }
  parts.push('Z');
  return parts.join('');
}

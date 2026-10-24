import type { PenStyle, StrokeElement, StrokePoint, StrokeTool } from '@/model/types';
import type { Vec } from './geometry';
import { splineResample } from './smoothing';

/**
 * Width model of a pen. Each style differs in how pressure, direction and position along the
 * stroke shape the line — not just in name.
 */
export interface WidthProfile {
  /** Minimum width as a fraction of base width at zero pressure. */
  minRatio: number;
  /** Fraction of the stroke length over which start/end taper is applied. */
  taper: number;
  /** Absolute cap of the taper length in document units. */
  taperMax: number;
  /** Direction model: broad nib at 45° (fountain) or pointed nib (thick downstrokes). */
  direction: 'none' | 'nib' | 'pointed';
  /** Exponent applied to pressure (>1 needs more force for full width). */
  pressureCurve: number;
  /** Spline-smooth the centre line before building the outline. */
  spline: boolean;
}

const P = (p: Partial<WidthProfile>): WidthProfile => ({ minRatio: 1, taper: 0, taperMax: 0, direction: 'none', pressureCurve: 1, spline: true, ...p });

export function widthProfile(tool: StrokeTool, style: PenStyle): WidthProfile {
  if (tool === 'shape') return P({ spline: false });
  if (tool === 'highlighter') return P({});
  switch (style) {
    case 'ball':
    case 'ballpoint':
      return P({ minRatio: 0.82 });
    case 'fountain':
      return P({ minRatio: 0.32, direction: 'nib', taper: 0.04, taperMax: 4 });
    case 'calligraphy':
      return P({ minRatio: 0.06, direction: 'pointed', pressureCurve: 1.25, taper: 0.08, taperMax: 14 });
    case 'brush':
      return P({ minRatio: 0.08, taper: 0.12, taperMax: 30, pressureCurve: 0.9 });
    case 'fineliner':
      return P({ minRatio: 0.94 });
    case 'pencil':
      return P({ minRatio: 0.6, pressureCurve: 1.1 });
    case 'marker':
      return P({ minRatio: 0.9 });
    case 'monoline':
      return P({ minRatio: 1 });
  }
}

/** Two-pass exponential smoothing so widths never jump between neighbouring samples. */
function smoothWidths(w: number[], alpha: number): void {
  for (let i = 1; i < w.length; i++) w[i] = w[i - 1]! + (w[i]! - w[i - 1]!) * alpha;
  for (let i = w.length - 2; i >= 0; i--) w[i] = w[i + 1]! + (w[i]! - w[i + 1]!) * alpha;
}

/**
 * Per-point widths in document units.
 * `simulated` = the device gave no real pressure; direction-based pens then derive contrast from
 * the stroke direction alone (explicitly a simulation, see docs/LIMITATIONS.md).
 */
export function computeWidths(points: readonly StrokePoint[], baseWidth: number, profile: WidthProfile, simulated = false): number[] {
  const n = points.length;
  const widths = new Array<number>(n);
  let total = 0;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    cum[i] = total;
  }
  const taperLen = Math.min(total * profile.taper, profile.taperMax || Infinity);
  const k = Math.max(1, Math.round(n / 200)) + 1; // neighbour distance for direction estimates
  for (let i = 0; i < n; i++) {
    let p = Math.pow(Math.min(1, Math.max(0, points[i]!.pressure)), profile.pressureCurve);
    let w: number;
    if (profile.direction === 'none') {
      w = baseWidth * (profile.minRatio + (1 - profile.minRatio) * p);
    } else {
      const a = points[Math.max(0, i - k)]!;
      const b = points[Math.min(n - 1, i + k)]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      if (profile.direction === 'pointed') {
        // Pointed pen: tines spread only when pulling down (y grows downwards on screen).
        // Upstrokes and sideways strokes stay hairline-thin.
        const down = Math.min(1, Math.max(0, (dy / len + 0.2) / 1.2));
        const shade = Math.pow(down, 1.4);
        if (simulated) p = 0.8;
        w = baseWidth * (profile.minRatio + (1 - profile.minRatio) * shade * (0.2 + 0.8 * p));
      } else {
        // Broad nib held at 45°: widest when moving perpendicular to the nib edge.
        const angle = Math.atan2(dy, dx);
        const nib = 0.55 + 0.45 * Math.abs(Math.sin(angle + Math.PI / 4));
        if (simulated) p = 0.65;
        w = baseWidth * (profile.minRatio + (1 - profile.minRatio) * p) * nib;
      }
    }
    if (taperLen > 0) {
      const t = Math.min(1, cum[i]! / taperLen, (total - cum[i]!) / taperLen);
      w *= 0.2 + 0.8 * Math.sin((t * Math.PI) / 2);
    }
    widths[i] = w;
  }
  if (n > 2 && profile.minRatio < 0.9) smoothWidths(widths, profile.direction === 'none' ? 0.45 : 0.3);
  for (let i = 0; i < n; i++) widths[i] = Math.max(0.25, widths[i]!);
  return widths;
}

/** Centre line used for rendering: spline-smoothed and resampled for most pens. */
export function renderPoints(stroke: Pick<StrokeElement, 'points' | 'baseWidth' | 'tool' | 'penStyle'>, profile = widthProfile(stroke.tool, stroke.penStyle)): readonly StrokePoint[] {
  if (!profile.spline || stroke.points.length < 3) return stroke.points;
  const spacing = Math.min(1.5, Math.max(0.35, stroke.baseWidth * 0.3));
  return splineResample(stroke.points, spacing);
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

export function strokeOutline(stroke: Pick<StrokeElement, 'points' | 'baseWidth' | 'tool' | 'penStyle' | 'simulatedPressure'>): Vec[] {
  const profile = widthProfile(stroke.tool, stroke.penStyle);
  const pts = renderPoints(stroke, profile);
  const widths = computeWidths(pts, stroke.baseWidth, profile, stroke.simulatedPressure === true);
  return outlinePolygon(pts, widths);
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

import type { ShapeKind, StrokePoint } from '@/model/types';
import { bboxFromPoints, dist, distPointSegment, pathLength, type Vec } from './geometry';

function pt(x: number, y: number, t = 0): StrokePoint {
  return { x, y, pressure: 0.5, timestamp: t, tiltX: 0, tiltY: 0 };
}

function polyline(vertices: Vec[], closed: boolean, step: number): StrokePoint[] {
  const verts = closed ? [...vertices, vertices[0]!] : vertices;
  const out: StrokePoint[] = [];
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const d = dist(a, b);
    const steps = Math.max(1, Math.ceil(d / step));
    for (let s = 0; s < steps; s++) out.push(pt(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps));
  }
  const last = verts[verts.length - 1]!;
  out.push(pt(last.x, last.y));
  return out;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): StrokePoint[] {
  const circumference = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(24, Math.min(180, Math.round(circumference / 4)));
  const out: StrokePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    out.push(pt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
  }
  return out;
}

/**
 * Generates stroke points for a geometric shape dragged from `a` to `b`.
 * `constrain` (Shift on keyboard) forces circles/squares and 45° lines.
 * Arrows are returned as separate polylines because the head is a distinct sub-path.
 */
export function shapePoints(kind: ShapeKind, a: Vec, b: Vec, constrain = false, headSize = 14): StrokePoint[][] {
  let bx = b.x;
  let by = b.y;
  if (constrain) {
    if (kind === 'line' || kind === 'arrow') {
      const ang = Math.atan2(by - a.y, bx - a.x);
      const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const len = dist(a, b);
      bx = a.x + Math.cos(snapped) * len;
      by = a.y + Math.sin(snapped) * len;
    } else {
      const s = Math.max(Math.abs(bx - a.x), Math.abs(by - a.y));
      bx = a.x + Math.sign(bx - a.x || 1) * s;
      by = a.y + Math.sign(by - a.y || 1) * s;
    }
  }
  const minX = Math.min(a.x, bx);
  const minY = Math.min(a.y, by);
  const maxX = Math.max(a.x, bx);
  const maxY = Math.max(a.y, by);
  const step = 6;
  switch (kind) {
    case 'line':
      return [polyline([a, { x: bx, y: by }], false, step)];
    case 'arrow': {
      const end = { x: bx, y: by };
      const ang = Math.atan2(by - a.y, bx - a.x);
      const h = Math.min(headSize, dist(a, end) * 0.4);
      const l = { x: bx - Math.cos(ang - Math.PI / 7) * h, y: by - Math.sin(ang - Math.PI / 7) * h };
      const r = { x: bx - Math.cos(ang + Math.PI / 7) * h, y: by - Math.sin(ang + Math.PI / 7) * h };
      return [polyline([a, end], false, step), polyline([l, end, r], false, step)];
    }
    case 'rectangle':
      return [polyline([{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], true, step)];
    case 'triangle':
      return [polyline([{ x: (minX + maxX) / 2, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], true, step)];
    case 'circle': {
      const r = Math.max(maxX - minX, maxY - minY) / 2;
      return [ellipsePoints((minX + maxX) / 2, (minY + maxY) / 2, r, r)];
    }
    case 'ellipse':
      return [ellipsePoints((minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2)];
  }
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function rdp(points: readonly Vec[], epsilon: number): Vec[] {
  if (points.length < 3) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distPointSegment(points[i]!, first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** True when the freehand stroke is close enough to a straight line to be straightened. */
export function isNearlyStraight(points: readonly Vec[], tolerance = 0.06): boolean {
  if (points.length < 2) return false;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const len = dist(a, b);
  if (len < 12) return false;
  let maxD = 0;
  for (const p of points) maxD = Math.max(maxD, distPointSegment(p, a, b));
  return maxD / len <= tolerance && pathLength(points) / len < 1.15;
}

export interface RecognizedShape {
  kind: ShapeKind;
  strokes: StrokePoint[][];
}

/**
 * Recognises a freehand stroke as a line, ellipse/circle, triangle or rectangle.
 * Returns null when no shape fits well; the stroke is then kept as drawn.
 */
export function recognizeShape(points: readonly Vec[]): RecognizedShape | null {
  if (points.length < 3) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (isNearlyStraight(points, 0.08)) return { kind: 'line', strokes: shapePoints('line', first, last) };
  const box = bboxFromPoints(points);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const size = Math.max(w, h);
  if (size < 16) return null;
  const length = pathLength(points);
  const closed = dist(first, last) < Math.max(18, length * 0.12);
  if (!closed) return null;

  const corners = rdp([...points, first], size * 0.1);
  // rdp on a closed loop returns start..end with the start duplicated at the end
  const vertexCount = corners.length - 1;

  // Ellipse fit: how uniform is the normalised radius?
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  let sum = 0;
  let sumSq = 0;
  for (const p of points) {
    const r = Math.hypot((p.x - cx) / (w / 2 || 1), (p.y - cy) / (h / 2 || 1));
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / points.length;
  const variance = sumSq / points.length - mean * mean;
  const ellipseScore = Math.sqrt(Math.max(0, variance)) / mean;

  if (vertexCount === 3) {
    const tri = corners.slice(0, 3);
    return { kind: 'triangle', strokes: [polyline(tri, true, 6)] };
  }
  if (vertexCount === 4 && ellipseScore > 0.08) {
    return { kind: 'rectangle', strokes: shapePoints('rectangle', { x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }) };
  }
  if (ellipseScore < 0.14) {
    const isCircle = Math.abs(w - h) / size < 0.18;
    return isCircle
      ? { kind: 'circle', strokes: shapePoints('circle', { x: cx - size / 2, y: cy - size / 2 }, { x: cx + size / 2, y: cy + size / 2 }) }
      : { kind: 'ellipse', strokes: shapePoints('ellipse', { x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }) };
  }
  if (vertexCount === 4) {
    return { kind: 'rectangle', strokes: shapePoints('rectangle', { x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }) };
  }
  return null;
}

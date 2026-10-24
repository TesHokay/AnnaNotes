import type { StrokeElement, StrokePoint } from '@/model/types';
import { bboxIntersects, bboxInflate, bboxFromPoints, distPointSegment, distSegmentSegment, strokeBBox, type Vec } from './geometry';

/** The eraser sweeps a capsule from `from` to `to` with the given radius. */
export interface EraserSweep {
  from: Vec;
  to: Vec;
  radius: number;
}

function sweepBBox(s: EraserSweep) {
  return bboxInflate(bboxFromPoints([s.from, s.to]), s.radius);
}

/** Whole-stroke eraser hit test. */
export function strokeHitBySweep(stroke: StrokeElement, sweep: EraserSweep): boolean {
  if (!bboxIntersects(stroke.boundingBox, sweepBBox(sweep))) return false;
  const reach = sweep.radius + stroke.baseWidth / 2;
  const pts = stroke.points;
  if (pts.length === 1) return distPointSegment(pts[0]!, sweep.from, sweep.to) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distSegmentSegment(pts[i - 1]!, pts[i]!, sweep.from, sweep.to) <= reach) return true;
  }
  return false;
}

function lerpPoint(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    timestamp: a.timestamp + (b.timestamp - a.timestamp) * t,
    tiltX: a.tiltX + (b.tiltX - a.tiltX) * t,
    tiltY: a.tiltY + (b.tiltY - a.tiltY) * t,
  };
}

/** Insert interpolated points so consecutive points are at most `maxGap` apart. */
export function resample(points: readonly StrokePoint[], maxGap: number): StrokePoint[] {
  if (points.length < 2) return points.slice();
  const out: StrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / maxGap);
    for (let s = 1; s < steps; s++) out.push(lerpPoint(a, b, s / steps));
    out.push(b);
  }
  return out;
}

/**
 * Partial eraser. Returns `null` when the stroke is untouched, otherwise the remaining
 * fragments (possibly empty when the stroke was erased completely). Fragments get fresh IDs
 * from `makeId`, the caller replaces the original stroke with them.
 */
export function eraseStrokePartially(stroke: StrokeElement, sweep: EraserSweep, makeId: () => string): StrokeElement[] | null {
  if (!strokeHitBySweep(stroke, sweep)) return null;
  const reach = sweep.radius + stroke.baseWidth * 0.35;
  const dense = resample(stroke.points, Math.max(0.5, sweep.radius / 3));
  const fragments: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  for (const p of dense) {
    if (distPointSegment(p, sweep.from, sweep.to) <= reach) {
      if (current.length) fragments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length) fragments.push(current);
  const result: StrokeElement[] = [];
  for (const frag of fragments) {
    // Drop crumbs that would be shorter than the pen tip.
    if (frag.length < 2) continue;
    const first = frag[0]!;
    const last = frag[frag.length - 1]!;
    if (frag.length < 4 && Math.hypot(last.x - first.x, last.y - first.y) < stroke.baseWidth * 0.5) continue;
    result.push({
      ...stroke,
      id: makeId(),
      points: frag,
      boundingBox: strokeBBox(frag, stroke.baseWidth),
      shape: undefined,
    });
  }
  return result;
}

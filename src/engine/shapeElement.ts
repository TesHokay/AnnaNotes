import type { BBox, ShapeElement, ShapeElementKind } from '@/model/types';
import { applyMatrix, bboxFromPoints, distPointSegment, pointInPolygon, rotationAbout, type Matrix, type Vec } from './geometry';

/**
 * Vector shapes are stored as a box (x, y, width, height, rotation about the centre) plus, for
 * lines/arrows/polygons, points in box-local coordinates. Everything visual is derived from this,
 * so shapes stay editable (resize per axis, rotate, restyle) after saving and reopening.
 */

const ELLIPSE_SEGMENTS = 64;

function localToPage(el: ShapeElement): Matrix {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const r = rotationAbout(el.rotation, cx, cy);
  return [r[0], r[1], r[2], r[3], r[0] * el.x + r[2] * el.y + r[4], r[1] * el.x + r[3] * el.y + r[5]];
}

/** Box-local outline polylines (closed flag) before rotation. */
export function shapeLocalPaths(el: Pick<ShapeElement, 'kind' | 'width' | 'height' | 'points' | 'cornerRadius' | 'strokeWidth'>): { pts: Vec[]; closed: boolean }[] {
  const w = el.width;
  const h = el.height;
  switch (el.kind) {
    case 'line':
    case 'arrow': {
      const [a, b] = el.points && el.points.length >= 2 ? el.points : [{ x: 0, y: 0 }, { x: w, y: h }];
      const paths = [{ pts: [a!, b!], closed: false }];
      if (el.kind === 'arrow') {
        const ang = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        const len = Math.hypot(b!.x - a!.x, b!.y - a!.y);
        const head = Math.min(Math.max(10, el.strokeWidth * 5), len * 0.45);
        paths.push({
          pts: [
            { x: b!.x - Math.cos(ang - Math.PI / 7) * head, y: b!.y - Math.sin(ang - Math.PI / 7) * head },
            b!,
            { x: b!.x - Math.cos(ang + Math.PI / 7) * head, y: b!.y - Math.sin(ang + Math.PI / 7) * head },
          ],
          closed: false,
        });
      }
      return paths;
    }
    case 'rectangle':
      return [{ pts: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], closed: true }];
    case 'roundedRect': {
      const r = Math.max(0, Math.min(el.cornerRadius ?? 12, w / 2, h / 2));
      const pts: Vec[] = [];
      const corner = (cx: number, cy: number, a0: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
      };
      corner(w - r, r, -Math.PI / 2);
      corner(w - r, h - r, 0);
      corner(r, h - r, Math.PI / 2);
      corner(r, r, Math.PI);
      return [{ pts, closed: true }];
    }
    case 'ellipse': {
      const pts: Vec[] = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push({ x: w / 2 + Math.cos(a) * (w / 2), y: h / 2 + Math.sin(a) * (h / 2) });
      }
      return [{ pts, closed: true }];
    }
    case 'triangle':
      return [{ pts: el.points && el.points.length === 3 ? el.points : [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }], closed: true }];
    case 'polygon':
    case 'freeform':
      return [{ pts: el.points ?? [], closed: true }];
  }
}

/** Outline polylines in page coordinates (rotation applied). */
export function shapePagePaths(el: ShapeElement): { pts: Vec[]; closed: boolean }[] {
  const m = localToPage(el);
  return shapeLocalPaths(el).map((p) => ({ closed: p.closed, pts: p.pts.map((q) => applyMatrix(m, q)) }));
}

export function shapeBBox(el: ShapeElement): BBox {
  const all = shapePagePaths(el).flatMap((p) => p.pts);
  return bboxFromPoints(all, el.strokeWidth / 2 + 1);
}

export function isClosedShape(kind: ShapeElementKind): boolean {
  return kind !== 'line' && kind !== 'arrow';
}

/** Hit test: inside a filled closed shape, or within `tolerance` of the outline. */
export function hitShape(el: ShapeElement, p: Vec, tolerance: number): boolean {
  const reach = tolerance + el.strokeWidth / 2;
  for (const path of shapePagePaths(el)) {
    const pts = path.pts;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) if (distPointSegment(p, pts[i]!, pts[i + 1]!) <= reach) return true;
    if (path.closed && n > 2) {
      if (distPointSegment(p, pts[n - 1]!, pts[0]!) <= reach) return true;
      if (el.fill && pointInPolygon(p, pts)) return true;
    }
  }
  return false;
}

export function tracePaths(ctx: CanvasRenderingContext2D | Path2D, paths: { pts: Vec[]; closed: boolean }[]): void {
  for (const { pts, closed } of paths) {
    if (pts.length < 2) continue;
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    if (closed) ctx.closePath();
  }
}

export function drawShapeElement(ctx: CanvasRenderingContext2D, el: ShapeElement): void {
  const paths = shapePagePaths(el);
  ctx.save();
  ctx.globalAlpha = el.opacity;
  if (el.fill && isClosedShape(el.kind)) {
    const fillPath = new Path2D();
    tracePaths(fillPath, paths.filter((p) => p.closed));
    ctx.fillStyle = el.fill;
    ctx.fill(fillPath);
  }
  if (el.strokeWidth > 0) {
    const path = new Path2D();
    tracePaths(path, paths);
    ctx.lineWidth = el.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = el.stroke;
    ctx.stroke(path);
  }
  ctx.restore();
}

/** SVG path data (page coordinates) — used for vector PDF export. */
export function shapeSvgPath(el: ShapeElement, closedOnly = false): string {
  const f = (v: number) => v.toFixed(2);
  return shapePagePaths(el)
    .filter((p) => !closedOnly || p.closed)
    .map(({ pts, closed }) => (pts.length < 2 ? '' : `M${f(pts[0]!.x)} ${f(pts[0]!.y)}` + pts.slice(1).map((q) => `L${f(q.x)} ${f(q.y)}`).join('') + (closed ? 'Z' : '')))
    .join('');
}

/** Builds a shape from a drag (start → end) in page coordinates. */
export function shapeFromDrag(kind: ShapeElementKind, a: Vec, b: Vec, constrain: boolean): Pick<ShapeElement, 'kind' | 'x' | 'y' | 'width' | 'height' | 'points'> {
  let bx = b.x;
  let by = b.y;
  if (constrain) {
    if (kind === 'line' || kind === 'arrow') {
      const ang = Math.round(Math.atan2(by - a.y, bx - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(bx - a.x, by - a.y);
      bx = a.x + Math.cos(ang) * len;
      by = a.y + Math.sin(ang) * len;
    } else {
      const s = Math.max(Math.abs(bx - a.x), Math.abs(by - a.y));
      bx = a.x + Math.sign(bx - a.x || 1) * s;
      by = a.y + Math.sign(by - a.y || 1) * s;
    }
  }
  const x = Math.min(a.x, bx);
  const y = Math.min(a.y, by);
  const width = Math.abs(bx - a.x);
  const height = Math.abs(by - a.y);
  if (kind === 'line' || kind === 'arrow') return { kind, x, y, width, height, points: [{ x: a.x - x, y: a.y - y }, { x: bx - x, y: by - y }] };
  if (kind === 'polygon') {
    // Regular hexagon inscribed in the dragged box.
    const points = Array.from({ length: 6 }, (_, i) => {
      const ang = -Math.PI / 2 + (i / 6) * Math.PI * 2;
      return { x: width / 2 + (Math.cos(ang) * width) / 2, y: height / 2 + (Math.sin(ang) * height) / 2 };
    });
    return { kind, x, y, width, height, points };
  }
  return { kind, x, y, width, height };
}

/** Polygon points (page coords) → shape with box-local points. */
export function shapeFromPolygon(kind: 'triangle' | 'polygon' | 'freeform', pts: readonly Vec[]): Pick<ShapeElement, 'kind' | 'x' | 'y' | 'width' | 'height' | 'points'> {
  const b = bboxFromPoints(pts);
  return { kind, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY, points: pts.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY })) };
}

/**
 * Non-uniform resize in the shape's own (rotated) frame: `local` is the new box in local
 * coordinates of the *old* box (origin at old top-left, unrotated). Points scale with the box.
 */
export function resizeShapeLocal<T extends Pick<ShapeElement, 'x' | 'y' | 'width' | 'height' | 'rotation'> & { points?: Vec[] }>(el: T, local: { x: number; y: number; width: number; height: number }): T {
  const sx = el.width > 1e-6 ? local.width / el.width : 1;
  const sy = el.height > 1e-6 ? local.height / el.height : 1;
  // New centre: local box centre mapped through the old box's rotation.
  const oc = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  const lc = { x: el.x + local.x + local.width / 2, y: el.y + local.y + local.height / 2 };
  const c = applyMatrix(rotationAbout(el.rotation, oc.x, oc.y), lc);
  return {
    ...el,
    x: c.x - local.width / 2,
    y: c.y - local.height / 2,
    width: local.width,
    height: local.height,
    points: el.points?.map((p) => ({ x: p.x * sx, y: p.y * sy })),
  };
}

/** Page point → box-local coordinates (inverse rotation). */
export function pageToLocal(el: Pick<ShapeElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>, p: Vec): Vec {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const q = applyMatrix(rotationAbout(-el.rotation, cx, cy), p);
  return { x: q.x - el.x, y: q.y - el.y };
}

export function localToPagePoint(el: Pick<ShapeElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>, p: Vec): Vec {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return applyMatrix(rotationAbout(el.rotation, cx, cy), { x: el.x + p.x, y: el.y + p.y });
}

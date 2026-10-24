import type { ImageElement, PageElement, ShapeElement, UUID } from '@/model/types';
import { dist, type Vec } from './geometry';
import { drawElements } from './renderer';
import { localToPagePoint, pageToLocal, resizeShapeLocal } from './shapeElement';
import { selectionBBox, type Action, type Sample, type ToolContext } from './tools';

/** Elements edited with an oriented frame and per-axis resize handles. */
export type BoxElement = ShapeElement | ImageElement;

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLE_PX = 22;
const ROTATE_PX = 30;

export function isBoxElement(el: PageElement | undefined): el is BoxElement {
  return !!el && (el.type === 'shape' || el.type === 'image');
}

/** Handle positions in page coordinates (they follow the element's rotation). */
export function orientedHandles(el: BoxElement, scale: number): { resize: Record<ResizeHandle, Vec>; rotate: Vec; corners: Vec[] } {
  const w = el.width;
  const h = el.height;
  const L = (x: number, y: number) => localToPagePoint(el, { x, y });
  return {
    resize: { nw: L(0, 0), n: L(w / 2, 0), ne: L(w, 0), e: L(w, h / 2), se: L(w, h), s: L(w / 2, h), sw: L(0, h), w: L(0, h / 2) },
    rotate: L(w / 2, -ROTATE_PX / scale),
    corners: [L(0, 0), L(w, 0), L(w, h), L(0, h)],
  };
}

export type BoxHit = { kind: 'resize'; handle: ResizeHandle } | { kind: 'rotate' } | { kind: 'move' } | null;

export function hitBoxHandles(el: BoxElement, p: Vec, scale: number): BoxHit {
  const r = HANDLE_PX / scale;
  const h = orientedHandles(el, scale);
  if (dist(p, h.rotate) <= r) return { kind: 'rotate' };
  // Lines/arrows have a degenerate box in one axis: only offer the corner handles there.
  const thin = el.width * scale < 12 || el.height * scale < 12;
  for (const [k, v] of Object.entries(h.resize) as [ResizeHandle, Vec][]) {
    if (thin && k.length === 1) continue;
    if (dist(p, v) <= r) return { kind: 'resize', handle: k };
  }
  const local = pageToLocal(el, p);
  const pad = 8 / scale;
  if (local.x >= -pad && local.x <= el.width + pad && local.y >= -pad && local.y <= el.height + pad) return { kind: 'move' };
  return null;
}

export function drawOrientedFrame(ctx: CanvasRenderingContext2D, el: BoxElement, scale: number): void {
  const h = orientedHandles(el, scale);
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = '#e86c9e';
  ctx.setLineDash([5 / scale, 4 / scale]);
  ctx.beginPath();
  h.corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(h.resize.n.x, h.resize.n.y);
  ctx.lineTo(h.rotate.x, h.rotate.y);
  ctx.stroke();
  const thin = el.width * scale < 12 || el.height * scale < 12;
  const knob = (p: Vec, round: boolean) => {
    ctx.beginPath();
    if (round) ctx.arc(p.x, p.y, 6.5 / scale, 0, Math.PI * 2);
    else ctx.rect(p.x - 5 / scale, p.y - 5 / scale, 10 / scale, 10 / scale);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2 / scale;
    ctx.stroke();
  };
  for (const [k, p] of Object.entries(h.resize)) if (!(thin && k.length === 1)) knob(p, k.length === 2);
  knob(h.rotate, true);
  ctx.restore();
}

/** Resize one shape/image along its own (rotated) axes. */
export class BoxResizeAction implements Action {
  private current: BoxElement;
  private moved = false;

  constructor(
    private readonly ctx: ToolContext,
    private readonly original: BoxElement,
    private readonly handle: ResizeHandle,
    private readonly start: Sample,
  ) {
    this.current = original;
    ctx.setHidden(original.pageId, new Set([original.id]));
  }

  get pageId(): UUID {
    return this.original.pageId;
  }

  move(samples: Sample[], _p: Sample[], mods: { shift: boolean }): void {
    const s = samples[samples.length - 1];
    if (!s) return;
    if (dist(s, this.start) * this.ctx.scale() > 2) this.moved = true;
    const o = this.original;
    const p = pageToLocal(o, s);
    let left = 0;
    let top = 0;
    let right = o.width;
    let bottom = o.height;
    const hd = this.handle;
    if (hd.includes('e')) right = p.x;
    if (hd.includes('w')) left = p.x;
    if (hd.includes('s')) bottom = p.y;
    if (hd.includes('n')) top = p.y;
    const min = 4 / this.ctx.scale();
    // Images keep their aspect ratio on corner handles unless Shift; shapes are free unless Shift.
    const keepAspect = hd.length === 2 && (o.type === 'image' ? !mods.shift : mods.shift);
    if (keepAspect && o.width > 0 && o.height > 0) {
      const k = Math.max((right - left) / o.width, (bottom - top) / o.height);
      const w = Math.max(min, o.width * k);
      const h = Math.max(min, o.height * k);
      if (hd.includes('w')) left = right - w;
      else right = left + w;
      if (hd.includes('n')) top = bottom - h;
      else bottom = top + h;
    }
    // No mirroring through the opposite edge: clamp to a minimum size.
    if (right - left < min) {
      if (hd.includes('w')) left = right - min;
      else right = left + min;
    }
    if (bottom - top < min) {
      if (hd.includes('n')) top = bottom - min;
      else bottom = top + min;
    }
    this.current = resizeShapeLocal(o, { x: left, y: top, width: right - left, height: bottom - top }) as BoxElement;
    this.ctx.requestOverlay();
  }

  end(cancelled: boolean): void {
    this.ctx.setHidden(this.original.pageId, null);
    if (cancelled || !this.moved) {
      this.ctx.requestOverlay();
      return;
    }
    this.ctx.model.apply({ removed: [this.original], added: [this.current] }, { history: 'Размер', persist: true });
    this.ctx.setSelection({ pageId: this.original.pageId, ids: [this.current.id], bbox: selectionBBox([this.current]) });
  }

  abort(): void {
    this.ctx.setHidden(this.original.pageId, null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    drawElements(ctx, [this.current], { resolveImage: this.ctx.resolveImage });
    drawOrientedFrame(ctx, this.current, this.ctx.scale());
  }
}

import { clamp } from '@/lib/utils';
import type { BBox } from '@/model/types';
import type { Vec } from './geometry';

export const PAGE_GAP = 24;
/** Zoom range 50%..400% (100% = 1 pt per CSS px). */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

export interface PageSize {
  id: string;
  width: number;
  height: number;
}

export interface PageSlot extends PageSize {
  index: number;
  /** top-left corner in document-strip coordinates */
  x: number;
  y: number;
}

export interface Layout {
  slots: PageSlot[];
  width: number;
  height: number;
}

/**
 * Pages are stacked vertically and centred on x = 0 of the "document strip" coordinate space.
 * Page-local coordinates = strip coordinates minus the slot origin.
 */
export function computeLayout(pages: readonly PageSize[], gap = PAGE_GAP): Layout {
  let y = 0;
  let maxW = 0;
  const slots: PageSlot[] = pages.map((p, index) => {
    const slot = { ...p, index, x: -p.width / 2, y };
    y += p.height + gap;
    maxW = Math.max(maxW, p.width);
    return slot;
  });
  return { slots, width: maxW, height: Math.max(0, y - gap) };
}

/** Binary search for the slots intersecting the vertical range [top, bottom]. */
export function visibleSlots(layout: Layout, top: number, bottom: number): PageSlot[] {
  const s = layout.slots;
  let lo = 0;
  let hi = s.length - 1;
  let first = s.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.y + s[mid]!.height >= top) {
      first = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  const out: PageSlot[] = [];
  for (let i = first; i < s.length && s[i]!.y <= bottom; i++) out.push(s[i]!);
  return out;
}

export function slotAt(layout: Layout, p: Vec): PageSlot | null {
  for (const slot of visibleSlots(layout, p.y, p.y)) {
    if (p.x >= slot.x && p.x <= slot.x + slot.width && p.y >= slot.y && p.y <= slot.y + slot.height) return slot;
  }
  return null;
}

/**
 * Screen mapping: screen = strip * scale + (tx, ty), in CSS pixels relative to the canvas.
 */
export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;
  width = 0;
  height = 0;

  toScreen(p: Vec): Vec {
    return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty };
  }

  toDoc(p: Vec): Vec {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale };
  }

  /** Visible region in strip coordinates. */
  visibleRect(): BBox {
    const a = this.toDoc({ x: 0, y: 0 });
    const b = this.toDoc({ x: this.width, y: this.height });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const f = next / this.scale;
    this.tx = sx - (sx - this.tx) * f;
    this.ty = sy - (sy - this.ty) * f;
    this.scale = next;
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /** Keep the content reachable: centre horizontally when narrower than the screen, clamp otherwise. */
  clampTo(layout: Layout, margin = 40): void {
    const contentW = layout.width * this.scale;
    const contentH = layout.height * this.scale;
    if (contentW + margin * 2 <= this.width) {
      this.tx = this.width / 2;
    } else {
      const minTx = this.width - margin - (layout.width / 2) * this.scale;
      const maxTx = margin + (layout.width / 2) * this.scale;
      this.tx = clamp(this.tx, minTx, maxTx);
    }
    const minTy = Math.min(margin, this.height - margin - contentH);
    const maxTy = margin;
    this.ty = clamp(this.ty, minTy, maxTy);
  }

  fitWidthScale(layout: Layout, margin = 24): number {
    if (!layout.width) return 1;
    return clamp((this.width - margin * 2) / layout.width, MIN_SCALE, MAX_SCALE);
  }

  snapshot(): { scale: number; tx: number; ty: number } {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  restore(s: { scale: number; tx: number; ty: number }): void {
    this.scale = s.scale;
    this.tx = s.tx;
    this.ty = s.ty;
  }
}

/**
 * Bitmap resolution bucket for a given zoom. Re-rendering page bitmaps on every zoom step would
 * be wasteful; we quantise to half-octaves so a bitmap is reused for a range of zoom levels.
 */
export function resolutionBucket(scale: number, dpr: number): number {
  const target = scale * dpr;
  return Math.pow(2, Math.ceil(Math.log2(target) * 2) / 2);
}

/** Cap a bitmap resolution so width*height*res² stays under `maxPixels` (iOS canvas memory limits). */
export function capResolution(res: number, width: number, height: number, maxPixels: number): number {
  const pixels = width * height * res * res;
  if (pixels <= maxPixels) return res;
  return Math.sqrt(maxPixels / (width * height));
}

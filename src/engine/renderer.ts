import { isDarkPaper } from '@/model/paper';
import { paperDecor, resolveRuling, rgba, type DecorShape } from '@/model/cutePaper';
import type { BBox, ImageElement, Page, PageElement, ShapeElement, StrokeElement, TextElement } from '@/model/types';
import { drawShapeElement } from './shapeElement';
import { bboxIntersects, elementBBox } from './geometry';
import type { DecodedImage } from './imageCache';
import { strokeOutline, tracePolygon } from './outline';
import { layoutText, LINE_HEIGHT, TEXT_PADDING, fontString } from './text';

export type ImageResolver = (assetId: string) => DecodedImage | null;

/** Path2D cache keyed by element object identity (elements are immutable snapshots). */
const pathCache = new WeakMap<StrokeElement, Path2D>();

export function strokePath(stroke: StrokeElement): Path2D {
  let p = pathCache.get(stroke);
  if (!p) {
    p = new Path2D();
    tracePolygon(p, strokeOutline(stroke));
    pathCache.set(stroke, p);
  }
  return p;
}

const grainCache = new Map<string, CanvasPattern | null>();

/**
 * Graphite texture for the pencil: a tile of the ink colour with per-pixel alpha noise. It is
 * deterministic (seeded) so the same stroke always looks the same.
 */
function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const cached = grainCache.get(color);
  if (cached !== undefined) return cached ?? color;
  let pattern: CanvasPattern | null = null;
  try {
    const size = 48;
    const tile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const tctx = tile.getContext('2d') as CanvasRenderingContext2D | null;
    const m = /^#?([0-9a-f]{6})$/i.exec(color);
    if (tctx && m) {
      const n = parseInt(m[1]!, 16);
      const img = tctx.createImageData(size, size);
      let seed = 1234567;
      for (let i = 0; i < size * size; i++) {
        seed = (seed * 16807) % 2147483647;
        const r = seed / 2147483647;
        img.data[i * 4] = (n >> 16) & 255;
        img.data[i * 4 + 1] = (n >> 8) & 255;
        img.data[i * 4 + 2] = n & 255;
        img.data[i * 4 + 3] = Math.round(255 * (0.35 + 0.65 * Math.pow(r, 0.6)));
      }
      tctx.putImageData(img, 0, 0);
      pattern = ctx.createPattern(tile as CanvasImageSource, 'repeat');
      // Grain size in page units, independent of the bitmap resolution.
      pattern?.setTransform?.(new DOMMatrix().scaleSelf(0.5, 0.5));
    }
  } catch {
    pattern = null;
  }
  grainCache.set(color, pattern);
  return pattern ?? color;
}

export function strokeFillStyle(ctx: CanvasRenderingContext2D, color: string, penStyle: StrokeElement['penStyle']): string | CanvasPattern {
  return penStyle === 'pencil' ? pencilPattern(ctx, color) : color;
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeElement, opaque = false): void {
  ctx.fillStyle = stroke.tool === 'pen' ? strokeFillStyle(ctx, stroke.color, stroke.penStyle) : stroke.color;
  ctx.globalAlpha = opaque ? 1 : stroke.opacity;
  ctx.fill(strokePath(stroke));
  ctx.globalAlpha = 1;
}

export function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement): void {
  if (!el.text) return;
  ctx.save();
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  if (el.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }
  const lines = layoutText(ctx, el);
  ctx.font = fontString(el);
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = el.align;
  const x = el.align === 'left' ? el.x + TEXT_PADDING : el.align === 'center' ? cx : el.x + el.width - TEXT_PADDING;
  const lh = el.fontSize * LINE_HEIGHT;
  const offset = (lh - el.fontSize) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, el.y + TEXT_PADDING + i * lh + offset));
  ctx.restore();
}

export function drawImageElement(ctx: CanvasRenderingContext2D, el: ImageElement, resolve: ImageResolver): void {
  const img = resolve(el.assetId);
  ctx.save();
  if (el.rotation || el.flipX || el.flipY) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate(el.rotation);
    if (el.flipX || el.flipY) ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    ctx.translate(-cx, -cy);
  }
  if (el.opacity !== undefined && el.opacity < 1) ctx.globalAlpha = Math.max(0.05, el.opacity);
  if (img) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, el.x, el.y, el.width, el.height);
  } else {
    ctx.fillStyle = 'rgba(120,120,128,0.12)';
    ctx.fillRect(el.x, el.y, el.width, el.height);
  }
  ctx.restore();
}

let scratch: HTMLCanvasElement | OffscreenCanvas | null = null;

function getScratch(w: number, h: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (!scratch) scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  return scratch.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

/**
 * Highlighter strokes are drawn opaque into a scratch layer and composited once with the
 * group's opacity, so overlapping highlights keep a uniform transparency instead of darkening.
 */
function drawHighlighterLayer(ctx: CanvasRenderingContext2D, strokes: StrokeElement[], region?: BBox): void {
  const groups = new Map<number, StrokeElement[]>();
  for (const s of strokes) {
    const g = groups.get(s.opacity) ?? [];
    g.push(s);
    groups.set(s.opacity, g);
  }
  const t = ctx.getTransform();
  // Work only on the pixels that are being repainted (dirty rect), not the whole bitmap.
  let px = 0;
  let py = 0;
  let w = ctx.canvas.width;
  let h = ctx.canvas.height;
  if (region) {
    const x0 = Math.max(0, Math.floor(t.a * region.minX + t.e));
    const y0 = Math.max(0, Math.floor(t.d * region.minY + t.f));
    const x1 = Math.min(w, Math.ceil(t.a * region.maxX + t.e));
    const y1 = Math.min(h, Math.ceil(t.d * region.maxY + t.f));
    if (x1 <= x0 || y1 <= y0) return;
    px = x0;
    py = y0;
    w = x1 - x0;
    h = y1 - y0;
  }
  for (const [opacity, group] of groups) {
    const sctx = getScratch(w, h);
    if (!sctx) {
      for (const s of group) drawStroke(ctx, s);
      continue;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.setTransform(t.a, t.b, t.c, t.d, t.e - px, t.f - py);
    for (const s of group) {
      sctx.fillStyle = s.color;
      sctx.fill(strokePath(s));
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.drawImage(sctx.canvas as CanvasImageSource, 0, 0, w, h, px, py, w, h);
    ctx.restore();
  }
}

export interface DrawElementsOptions {
  resolveImage: ImageResolver;
  skip?: ReadonlySet<string>;
  /** Only elements intersecting this region (page coords) are drawn. */
  region?: BBox;
}

/**
 * Draws page elements in layers: images, highlighter, ink (pen + shapes), text. The context
 * transform must map page coordinates to pixels.
 */
export function drawElements(ctx: CanvasRenderingContext2D, elements: readonly PageElement[], opts: DrawElementsOptions): void {
  const images: ImageElement[] = [];
  const highlights: StrokeElement[] = [];
  const ink: (StrokeElement | ShapeElement)[] = [];
  const texts: TextElement[] = [];
  for (const el of elements) {
    if (opts.skip?.has(el.id)) continue;
    if (opts.region && !bboxIntersects(elementBBox(el), opts.region)) continue;
    if (el.type === 'image') images.push(el);
    else if (el.type === 'text') texts.push(el);
    else if (el.type === 'shape') ink.push(el);
    else if (el.tool === 'highlighter') highlights.push(el);
    else ink.push(el);
  }
  for (const el of images) drawImageElement(ctx, el, opts.resolveImage);
  if (highlights.length) drawHighlighterLayer(ctx, highlights, opts.region);
  for (const s of ink) {
    if (s.type === 'shape') drawShapeElement(ctx, s);
    else drawStroke(ctx, s);
  }
  for (const t of texts) drawTextElement(ctx, t);
}

const decorPaths = new Map<string, Path2D>();

function decorPath(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = decorPaths.get(d);
  if (!p) {
    p = new Path2D(d);
    if (decorPaths.size > 60) decorPaths.clear();
    decorPaths.set(d, p);
  }
  return p;
}

function drawDecor(ctx: CanvasRenderingContext2D, shapes: readonly DecorShape[], layer: DecorShape['layer']): void {
  for (const sh of shapes) {
    if (sh.layer !== layer) continue;
    const p = decorPath(sh.d);
    if (!p) continue;
    ctx.globalAlpha = sh.opacity;
    ctx.fillStyle = sh.fill;
    ctx.fill(p);
  }
  ctx.globalAlpha = 1;
}

/**
 * Paper colour, ruling and decorations (Cute Paper). The context transform must map page
 * coordinates to pixels. Everything is vector, so the ruling stays crisp at any zoom.
 */
export function drawTemplate(ctx: CanvasRenderingContext2D, page: Pick<Page, 'width' | 'height' | 'template' | 'paperColor' | 'style'>, pixelScale: number): void {
  ctx.fillStyle = page.paperColor;
  ctx.fillRect(0, 0, page.width, page.height);
  const decor = paperDecor(page);
  if (page.template === 'blank' && !decor.length) return;
  const r = resolveRuling(page);
  const dark = isDarkPaper(page.paperColor);
  const hair = Math.max(0.5 / pixelScale, 0.35);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, page.width, page.height);
  ctx.clip();
  drawDecor(ctx, decor, 'under');
  const s = r.spacing;
  if (page.template === 'dotted') {
    const rad = Math.max(0.8, 0.9 / pixelScale);
    ctx.fillStyle = rgba(r.color, Math.min(1, r.alpha + 0.16));
    ctx.beginPath();
    for (let y = s; y < page.height; y += s) {
      for (let x = s; x < page.width; x += s) {
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else if (page.template === 'grid') {
    ctx.strokeStyle = rgba(r.color, r.alpha);
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let x = s; x < page.width; x += s) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
    }
    for (let y = s; y < page.height; y += s) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
  } else if (page.template === 'lined') {
    ctx.strokeStyle = rgba(r.color, r.alpha);
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let y = s * 3; y < page.height - s / 2; y += s) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
    if (r.margin) {
      ctx.strokeStyle = dark ? 'rgba(255,120,120,0.35)' : 'rgba(230,80,80,0.35)';
      ctx.beginPath();
      ctx.moveTo(s * 3, 0);
      ctx.lineTo(s * 3, page.height);
      ctx.stroke();
    }
  }
  drawDecor(ctx, decor, 'over');
  ctx.restore();
}

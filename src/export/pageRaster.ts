import { getAsset, loadPageElements } from '@/db/repo';
import { drawElements, drawTemplate, drawTextElement } from '@/engine/renderer';
import { LINE_HEIGHT } from '@/engine/text';
import { renderPdfRegion } from '@/pdf/pdfjs';
import type { Page, PageElement, TextElement } from '@/model/types';
import { canvasToBlob } from '@/lib/images';
import { paperKey } from '@/model/cutePaper';
import type { DecodedImage } from '@/engine/imageCache';

const getBlob = async (id: string) => (await getAsset(id))?.blob;

async function decodeSvg(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeAll(elements: readonly PageElement[]): Promise<Map<string, DecodedImage>> {
  const map = new Map<string, DecodedImage>();
  for (const el of elements) {
    if (el.type !== 'image' || map.has(el.assetId)) continue;
    const blob = await getBlob(el.assetId);
    if (blob) {
      try {
        // createImageBitmap cannot decode SVG (stickers): fall back to <img>.
        map.set(el.assetId, blob.type === 'image/svg+xml' ? await decodeSvg(blob) : await createImageBitmap(blob));
      } catch {
        /* missing/undecodable image is drawn as a placeholder */
      }
    }
  }
  return map;
}

/** Renders a complete page (paper/PDF + annotations) to a canvas at `res` pixels per point. */
export async function renderPageCanvas(page: Page, res: number, elements?: readonly PageElement[]): Promise<HTMLCanvasElement> {
  const els = elements ?? (await loadPageElements(page.id));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.width * res));
  canvas.height = Math.max(1, Math.round(page.height * res));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  if (page.pdf) {
    const bg = await renderPdfRegion(page, res, { minX: 0, minY: 0, maxX: page.width, maxY: page.height }, new AbortController().signal, getBlob);
    if (bg) {
      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
      bg.width = bg.height = 0;
    }
  }
  ctx.setTransform(res, 0, 0, res, 0, 0);
  if (!page.pdf) drawTemplate(ctx, page, res);
  const images = await decodeAll(els);
  drawElements(ctx, els, { resolveImage: (id) => images.get(id) ?? null });
  for (const img of images.values()) if ('close' in img) img.close();
  return canvas;
}

export async function exportPagePng(page: Page, res = 3): Promise<Blob> {
  const canvas = await renderPageCanvas(page, res);
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return blob;
}

/** Rasterises a text element to PNG for PDF export (Cyrillic-safe). */
export async function rasterizeTextElement(el: TextElement): Promise<{ png: Uint8Array } | null> {
  const res = 4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(el.width * res));
  canvas.height = Math.max(1, Math.ceil(Math.max(el.height, el.fontSize * LINE_HEIGHT) * res));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(res, 0, 0, res, 0, 0);
  // Draw unrotated at the origin; rotation is applied by the PDF exporter.
  drawTextElement(ctx, { ...el, x: 0, y: 0, rotation: 0 });
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return { png: new Uint8Array(await blob.arrayBuffer()) };
}

const thumbCache = new Map<string, string>();

// Thumbnails are rendered one at a time in idle periods so they never compete with scrolling
// or drawing on the main thread.
let thumbChain: Promise<unknown> = Promise.resolve();
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 1500 });
    else setTimeout(resolve, 80);
  });
}
function enqueueThumb<T>(job: () => Promise<T>): Promise<T> {
  const run = async () => {
    await idle();
    return job();
  };
  const p = thumbChain.then(run, run);
  thumbChain = p.catch(() => null);
  return p;
}

/** Small JPEG thumbnail as an object URL, cached per page version. */
export async function pageThumbnail(page: Page, version: number, width = 180, elements?: readonly PageElement[]): Promise<string> {
  const key = `${page.id}:${version}:${paperKey(page)}:${page.width}`;
  const cached = thumbCache.get(key);
  if (cached) return cached;
  return enqueueThumb(() => renderThumb(page, key, width, elements));
}

async function renderThumb(page: Page, key: string, width: number, elements?: readonly PageElement[]): Promise<string> {
  const again = thumbCache.get(key);
  if (again) return again;
  const canvas = await renderPageCanvas(page, width / page.width, elements);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
  canvas.width = canvas.height = 0;
  const url = URL.createObjectURL(blob);
  for (const [k, v] of thumbCache) {
    if (k.startsWith(`${page.id}:`)) {
      URL.revokeObjectURL(v);
      thumbCache.delete(k);
    }
  }
  thumbCache.set(key, url);
  return url;
}

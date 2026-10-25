import { BlendMode, LineCapStyle, PDFDocument, PDFPage, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, type RGB } from 'pdf-lib';
import { strokeOutline, polygonToSvgPath } from '@/engine/outline';
import { isDarkPaper } from '@/model/paper';
import { hexToRgb01, paperDecor, resolveRuling, type DecorShape } from '@/model/cutePaper';
import type { Asset, ImageElement, Page, PageElement, ShapeElement, StrokeElement, TextElement, UUID } from '@/model/types';
import { isClosedShape, shapeSvgPath } from '@/engine/shapeElement';
import { flippedDocMatrix, normalizeRotation, type Matrix6 } from './coords';
import { visibleBox } from './importPdf';

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return rgb(0, 0, 0);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface RasterizedText {
  png: Uint8Array;
}

export interface ExportDeps {
  loadElements(pageId: UUID): Promise<PageElement[]>;
  getAsset(id: UUID): Promise<Asset | undefined>;
  /**
   * Text is rasterised because the standard PDF fonts cannot encode Cyrillic. Injected so the
   * exporter itself stays DOM-free (and testable in Node).
   */
  rasterizeText?(el: TextElement): Promise<RasterizedText | null>;
  /** Converts images that are neither PNG nor JPEG to PNG. */
  toPng?(blob: Blob): Promise<Uint8Array | null>;
  onProgress?(done: number, total: number): void;
}

function cm(page: PDFPage, m: Matrix6): void {
  page.pushOperators(concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
}

function drawDecorVector(page: PDFPage, p: Page, shapes: readonly DecorShape[], layer: DecorShape['layer']): void {
  const list = shapes.filter((sh) => sh.layer === layer);
  if (!list.length) return;
  // Decor paths are in document space (y down): same flip as the annotations.
  page.pushOperators(pushGraphicsState());
  cm(page, [1, 0, 0, 1, 0, p.height]);
  for (const sh of list) {
    const [r, g, b] = hexToRgb01(sh.fill);
    page.drawSvgPath(sh.d, { x: 0, y: 0, color: rgb(r, g, b), opacity: sh.opacity });
  }
  page.pushOperators(popGraphicsState());
}

/** Vector paper: colour, ruling and Cute Paper decorations, identical to the canvas renderer. */
function drawTemplateVector(page: PDFPage, p: Page): void {
  const { width: w, height: h } = p;
  if (p.paperColor.toLowerCase() !== '#ffffff') page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: hexToRgb(p.paperColor) });
  const decor = paperDecor(p);
  if (p.template === 'blank' && !decor.length) return;
  const r = resolveRuling(p);
  const [cr, cg, cb] = hexToRgb01(r.color);
  const color = rgb(cr, cg, cb);
  const opacity = r.alpha;
  const s = r.spacing;
  drawDecorVector(page, p, decor, 'under');
  // Ruling drawn in PDF space (y up): document y -> h - y.
  if (p.template === 'grid') {
    for (let x = s; x < w; x += s) page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.4, color, opacity });
    for (let y = s; y < h; y += s) page.drawLine({ start: { x: 0, y: h - y }, end: { x: w, y: h - y }, thickness: 0.4, color, opacity });
  } else if (p.template === 'lined') {
    for (let y = s * 3; y < h - s / 2; y += s) page.drawLine({ start: { x: 0, y: h - y }, end: { x: w, y: h - y }, thickness: 0.4, color, opacity });
    if (r.margin) page.drawLine({ start: { x: s * 3, y: 0 }, end: { x: s * 3, y: h }, thickness: 0.4, color: isDarkPaper(p.paperColor) ? rgb(1, 120 / 255, 120 / 255) : rgb(230 / 255, 80 / 255, 80 / 255), opacity: 0.35 });
  } else if (p.template === 'dotted') {
    for (let y = s; y < h; y += s) for (let x = s; x < w; x += s) page.drawCircle({ x, y: h - y, size: 0.8, color, opacity: Math.min(1, opacity + 0.16) });
  }
  drawDecorVector(page, p, decor, 'over');
}

function drawStroke(page: PDFPage, s: StrokeElement): void {
  const d = polygonToSvgPath(strokeOutline(s));
  if (!d) return;
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    color: hexToRgb(s.color),
    // Pencil grain is a raster effect; in vector PDF it becomes a slightly lighter solid line.
    opacity: s.penStyle === 'pencil' ? s.opacity * 0.8 : s.opacity,
    blendMode: s.tool === 'highlighter' ? BlendMode.Multiply : undefined,
  });
}

function drawShape(page: PDFPage, s: ShapeElement): void {
  if (s.fill && isClosedShape(s.kind)) {
    const fill = shapeSvgPath(s, true);
    if (fill) page.drawSvgPath(fill, { x: 0, y: 0, color: hexToRgb(s.fill), opacity: s.opacity });
  }
  const d = shapeSvgPath(s);
  if (d && s.strokeWidth > 0) {
    page.drawSvgPath(d, { x: 0, y: 0, borderColor: hexToRgb(s.stroke), borderWidth: s.strokeWidth, borderOpacity: s.opacity, borderLineCap: LineCapStyle.Round });
  }
}

/** Draws a box element (image/text bitmap) in flipped document space, honouring rotation. */
function drawBox(page: PDFPage, el: ImageElement | TextElement, draw: (x: number, y: number, w: number, h: number) => void): void {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = -el.rotation; // clockwise on screen (y down) = negative angle in y-up space
  page.pushOperators(pushGraphicsState());
  cm(page, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, -cy]);
  if (el.type === 'image' && (el.flipX || el.flipY)) cm(page, [el.flipX ? -1 : 1, 0, 0, el.flipY ? -1 : 1, 0, 0]);
  draw(-el.width / 2, -el.height / 2, el.width, el.height);
  page.pushOperators(popGraphicsState());
}

async function embedImage(out: PDFDocument, asset: Asset, deps: ExportDeps) {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (asset.mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50)) return out.embedPng(bytes);
  if (asset.mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8)) return out.embedJpg(bytes);
  const png = deps.toPng ? await deps.toPng(asset.blob) : null;
  return png ? out.embedPng(png) : null;
}

/**
 * Builds a PDF of the notebook. PDF-backed pages are copied from the original file (keeping
 * its vector content) and annotations are drawn on top; blank pages are generated with a vector
 * template. Strokes are exported as vector paths.
 */
export async function exportNotebookPdf(pages: readonly Page[], deps: ExportDeps, title = 'AnnaNotes'): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('AnnaNotes');
  out.setProducer('AnnaNotes (pdf-lib)');
  const sources = new Map<UUID, PDFDocument>();
  const images = new Map<UUID, Awaited<ReturnType<typeof embedImage>>>();

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    let page: PDFPage;
    let matrix: Matrix6;
    if (p.pdf) {
      let src = sources.get(p.pdf.assetId);
      if (!src) {
        const asset = await deps.getAsset(p.pdf.assetId);
        if (!asset) throw new Error('Исходный PDF не найден в хранилище');
        src = await PDFDocument.load(new Uint8Array(await asset.blob.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
        sources.set(p.pdf.assetId, src);
      }
      const [copied] = await out.copyPages(src, [p.pdf.pageIndex]);
      page = out.addPage(copied!);
      const box = visibleBox(page.getMediaBox(), page.getCropBox());
      const rotation = normalizeRotation(page.getRotation().angle);
      // Annotation coordinates are relative to the displayed page size stored at import time.
      const sx = (rotation === 90 || rotation === 270 ? box.height : box.width) / p.width;
      const base = flippedDocMatrix(box, rotation);
      matrix = sx === 1 ? base : [base[0] * sx, base[1] * sx, base[2] * sx, base[3] * sx, base[4], base[5]];
    } else {
      page = out.addPage([p.width, p.height]);
      drawTemplateVector(page, p);
      matrix = [1, 0, 0, 1, 0, p.height];
    }

    const elements = await deps.loadElements(p.id);
    if (elements.length) {
      page.pushOperators(pushGraphicsState());
      cm(page, matrix);
      const ordered = [
        ...elements.filter((e) => e.type === 'image'),
        ...elements.filter((e) => e.type === 'stroke' && e.tool === 'highlighter'),
        ...elements.filter((e) => (e.type === 'stroke' && e.tool !== 'highlighter') || e.type === 'shape').sort((a, b) => a.z - b.z),
        ...elements.filter((e) => e.type === 'text'),
      ];
      for (const el of ordered) {
        if (el.type === 'stroke') drawStroke(page, el);
        else if (el.type === 'shape') drawShape(page, el);
        else if (el.type === 'image') {
          let img = images.get(el.assetId);
          if (img === undefined) {
            const asset = await deps.getAsset(el.assetId);
            img = asset ? await embedImage(out, asset, deps) : null;
            images.set(el.assetId, img);
          }
          if (img) drawBox(page, el, (x, y, w, h) => page.drawImage(img!, { x, y, width: w, height: h, opacity: el.opacity ?? 1 }));
        } else if (el.type === 'text' && deps.rasterizeText) {
          const r = await deps.rasterizeText(el);
          if (r) {
            const png = await out.embedPng(r.png);
            drawBox(page, el, (x, y, w, h) => page.drawImage(png, { x, y, width: w, height: h }));
          }
        }
      }
      page.pushOperators(popGraphicsState());
    }
    deps.onProgress?.(i + 1, pages.length);
  }
  return out.save();
}

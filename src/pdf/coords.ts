/**
 * Mapping between page-local document coordinates (origin top-left, Y down, as displayed — i.e.
 * after /Rotate is applied) and PDF user space (origin bottom-left, Y up) of the original page.
 *
 * `box` is the visible box of the page (the CropBox, which pdf.js also uses for display).
 */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Matrix6 = [number, number, number, number, number, number];

export function normalizeRotation(r: number): 0 | 90 | 180 | 270 {
  const n = (((Math.round(r / 90) * 90) % 360) + 360) % 360;
  return n as 0 | 90 | 180 | 270;
}

/** Displayed page size for a box and rotation. */
export function displaySize(box: PdfBox, rotation: number): { width: number; height: number } {
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** Document (display) point -> PDF user space. */
export function docToPdf(x: number, y: number, box: PdfBox, rotation: number): { x: number; y: number } {
  const { x: cx, y: cy, width: cw, height: ch } = box;
  switch (normalizeRotation(rotation)) {
    case 0:
      return { x: cx + x, y: cy + ch - y };
    case 90:
      return { x: cx + y, y: cy + x };
    case 180:
      return { x: cx + cw - x, y: cy + y };
    case 270:
      return { x: cx + cw - y, y: cy + ch - x };
  }
}

/** PDF user space -> document (display) point. Inverse of docToPdf. */
export function pdfToDoc(px: number, py: number, box: PdfBox, rotation: number): { x: number; y: number } {
  const { x: cx, y: cy, width: cw, height: ch } = box;
  switch (normalizeRotation(rotation)) {
    case 0:
      return { x: px - cx, y: cy + ch - py };
    case 90:
      return { x: py - cy, y: px - cx };
    case 180:
      return { x: cx + cw - px, y: py - cy };
    case 270:
      return { x: cy + ch - py, y: cx + cw - px };
  }
}

/**
 * PDF content-stream matrix (for the `cm` operator) that lets us draw in "flipped document
 * space": coordinates (u, v) = (x, -y). pdf-lib's drawSvgPath draws SVG coordinates (y down) as
 * (x, -y), so with this matrix active an SVG path in document coordinates lands exactly where it
 * is displayed in the app.
 */
export function flippedDocMatrix(box: PdfBox, rotation: number): Matrix6 {
  const { x: cx, y: cy, width: cw, height: ch } = box;
  switch (normalizeRotation(rotation)) {
    case 0:
      return [1, 0, 0, 1, cx, cy + ch];
    case 90:
      return [0, 1, -1, 0, cx, cy];
    case 180:
      return [-1, 0, 0, -1, cx + cw, cy];
    case 270:
      return [0, -1, 1, 0, cx + cw, cy + ch];
  }
}

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BBox, Page, UUID } from '@/model/types';
import type { TextRun } from './textLayer';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js is large; load it (and its worker) only when a PDF is actually opened. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const docs = new Map<UUID, { promise: Promise<PDFDocumentProxy>; lastUsed: number }>();
const MAX_OPEN_DOCS = 3;

export function openPdf(assetId: UUID, getBlob: (id: UUID) => Promise<Blob | undefined>): Promise<PDFDocumentProxy> {
  const cached = docs.get(assetId);
  if (cached) {
    cached.lastUsed = performance.now();
    return cached.promise;
  }
  const promise = (async () => {
    const [pdfjs, blob] = await Promise.all([loadPdfJs(), getBlob(assetId)]);
    if (!blob) throw new Error('PDF-файл не найден в хранилище');
    const data = new Uint8Array(await blob.arrayBuffer());
    return pdfjs.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    }).promise;
  })();
  promise.catch(() => docs.delete(assetId));
  docs.set(assetId, { promise, lastUsed: performance.now() });
  if (docs.size > MAX_OPEN_DOCS) {
    const oldest = [...docs.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest && oldest[0] !== assetId) {
      docs.delete(oldest[0]);
      void oldest[1].promise.then((d) => d.destroy()).catch(() => {});
    }
  }
  return promise;
}

export function closeAllPdfs(): void {
  for (const { promise } of docs.values()) void promise.then((d) => d.destroy()).catch(() => {});
  docs.clear();
}

// Renders are serialised so the worker is never flooded when scrolling a large PDF; stale
// requests are aborted by the caller (the engine) via AbortSignal before they start.
let queue: Promise<unknown> = Promise.resolve();

export function renderPdfRegion(
  page: Page,
  res: number,
  region: BBox,
  signal: AbortSignal,
  getBlob: (id: UUID) => Promise<Blob | undefined>,
): Promise<HTMLCanvasElement | null> {
  const run = async (): Promise<HTMLCanvasElement | null> => {
    if (signal.aborted || !page.pdf) return null;
    const doc = await openPdf(page.pdf.assetId, getBlob);
    if (signal.aborted) return null;
    const pdfPage = await doc.getPage(page.pdf.pageIndex + 1);
    const viewport = pdfPage.getViewport({ scale: res * (page.width / pdfPage.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((region.maxX - region.minX) * res));
    canvas.height = Math.max(1, Math.ceil((region.maxY - region.minY) * res));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const task = pdfPage.render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -region.minX * res, -region.minY * res],
      background: page.paperColor || '#ffffff',
    });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      await task.promise;
    } catch (err) {
      canvas.width = canvas.height = 0;
      if (signal.aborted) return null;
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
      pdfPage.cleanup();
    }
    return canvas;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => null);
  return p;
}

const textCache = new Map<string, Promise<TextRun[]>>();

/** Text runs of a PDF page in page-local document coordinates (for highlighter snapping). */
export function getPageTextRuns(page: Page, getBlob: (id: UUID) => Promise<Blob | undefined>): Promise<TextRun[]> {
  if (!page.pdf) return Promise.resolve([]);
  const key = `${page.pdf.assetId}:${page.pdf.pageIndex}`;
  let p = textCache.get(key);
  if (!p) {
    p = (async () => {
      const doc = await openPdf(page.pdf!.assetId, getBlob);
      const pdfPage = await doc.getPage(page.pdf!.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: page.width / pdfPage.getViewport({ scale: 1 }).width });
      const content = await pdfPage.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [a, b, , , e, f] = item.transform as number[];
        const fontHeight = Math.hypot(a!, b!) || item.height;
        // Baseline-left and top-right corners in PDF space, converted to display space.
        const p1 = viewport.convertToViewportPoint(e!, f!);
        const p2 = viewport.convertToViewportPoint(e! + item.width, f! + fontHeight);
        runs.push({
          minX: Math.min(p1[0]!, p2[0]!),
          maxX: Math.max(p1[0]!, p2[0]!),
          minY: Math.min(p1[1]!, p2[1]!),
          maxY: Math.max(p1[1]!, p2[1]!),
          text: item.str,
        });
      }
      return runs;
    })();
    p.catch(() => textCache.delete(key));
    textCache.set(key, p);
    if (textCache.size > 200) textCache.delete(textCache.keys().next().value!);
  }
  return p;
}

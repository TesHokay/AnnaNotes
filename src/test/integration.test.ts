// @vitest-environment node
import 'fake-indexeddb/auto';
import { PDFDict, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PencilNotesDB, setDB } from '@/db/db';
import { addPage, createNotebook, getAsset, listPages, loadPageElements } from '@/db/repo';
import { SaveQueue } from '@/db/saveQueue';
import { DocumentModel } from '@/engine/DocumentModel';
import { exportNotebookPdf } from '@/pdf/exportPdf';
import { importPdfAsNotebook, ImportError } from '@/pdf/importPdf';
import { DEFAULT_SETUP } from '@/model/paper';
import { uuid } from '@/lib/id';
import { makeStroke, pts } from './helpers';
import type { ShapeElement } from '@/model/types';

/**
 * End-to-end data flow without the UI: the same modules the editor uses (DocumentModel →
 * SaveQueue → IndexedDB) and a "reload" simulated by opening a fresh connection.
 */
describe('notebook lifecycle (integration)', () => {
  it('create → add page → draw → save → reload → stroke is still there', async () => {
    const name = `int-${uuid()}`;
    setDB(new PencilNotesDB(name));
    const nb = await createNotebook({ title: 'Конспект' });
    const [first] = await listPages(nb.id);
    const second = await addPage(nb.id, first!.id, DEFAULT_SETUP);

    const queue = new SaveQueue(50);
    const model = new DocumentModel(nb.id, loadPageElements, queue);
    await model.ensureLoaded(second.id);
    const stroke = makeStroke(pts([[10, 10], [50, 40], [90, 20]]), { pageId: second.id, notebookId: nb.id });
    model.apply({ removed: [], added: [stroke] }, { history: 'Штрих', persist: true });
    await queue.flush();
    expect(queue.getState().status).toBe('saved');

    // "Reload": drop the connection and open the database again from scratch.
    const { getDB } = await import('@/db/db');
    getDB().close();
    setDB(new PencilNotesDB(name));
    const pages = await listPages(nb.id);
    expect(pages.map((p) => p.id)).toEqual([first!.id, second.id]);
    const els = await loadPageElements(second.id);
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ id: stroke.id, type: 'stroke' });
    expect((els[0] as typeof stroke).points).toHaveLength(3);
  });

  it('import PDF → annotate → export PDF with the original pages and annotations', async () => {
    setDB(new PencilNotesDB(`int-${uuid()}`));
    const src = await PDFDocument.create();
    src.addPage([400, 600]);
    const rotated = src.addPage([400, 600]);
    rotated.setRotation(degrees(90));
    const bytes = await src.save();

    const nb = await importPdfAsNotebook(new Blob([bytes], { type: 'application/pdf' }), 'lecture.pdf', null);
    expect(nb.kind).toBe('pdf');
    expect(nb.title).toBe('lecture');
    const pages = await listPages(nb.id);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatchObject({ width: 600, height: 400 }); // displayed size honours /Rotate
    expect(pages[0]!.pdf).toMatchObject({ pageIndex: 0 });

    const queue = new SaveQueue(50);
    const model = new DocumentModel(nb.id, loadPageElements, queue);
    for (const p of pages) {
      await model.ensureLoaded(p.id);
      model.apply(
        { removed: [], added: [makeStroke(pts([[20, 20], [200, 100]]), { pageId: p.id, notebookId: nb.id, tool: 'highlighter', opacity: 0.35, color: '#ffd60a', baseWidth: 12 })] },
        { history: 'Маркер', persist: true },
      );
    }
    await queue.flush();

    const out = await exportNotebookPdf(pages, { loadElements: loadPageElements, getAsset });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getSize()).toMatchObject({ width: 400, height: 600 });
    // Each page got an annotation graphics state (highlighter uses multiply blending).
    for (const page of doc.getPages()) {
      const gs = page.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
      expect(gs).toBeDefined();
      const blendModes = gs!.entries().map(([, v]) => (doc.context.lookup(v) as PDFDict).get(PDFName.of('BM'))?.toString());
      expect(blendModes).toContain('/Multiply');
    }
  });

  it('exports blank notebooks with vector templates', async () => {
    setDB(new PencilNotesDB(`int-${uuid()}`));
    const nb = await createNotebook({ title: 'grid', setup: { ...DEFAULT_SETUP, template: 'grid' } });
    const pages = await listPages(nb.id);
    const { getDB } = await import('@/db/db');
    await getDB().elements.add({
      id: uuid(), type: 'shape', pageId: pages[0]!.id, notebookId: nb.id, createdAt: 0, z: 1, kind: 'roundedRect',
      x: 50, y: 50, width: 200, height: 80, rotation: 0.3, stroke: '#e86c9e', strokeWidth: 3, opacity: 1, fill: '#fde2ec', cornerRadius: 12,
    } as ShapeElement);
    const out = await exportNotebookPdf(pages, { loadElements: loadPageElements, getAsset });
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  });

  it('rejects non-PDF files', async () => {
    setDB(new PencilNotesDB(`int-${uuid()}`));
    await expect(importPdfAsNotebook(new Blob(['hello']), 'x.pdf', null)).rejects.toBeInstanceOf(ImportError);
  });
});

import { PDFDocument } from 'pdf-lib';
import { exportNotebookPdf } from '@/pdf/exportPdf';
import { CUTE_PAPERS, paperDecor, paperKey, resolveRuling } from './cutePaper';
import { pageDimensions } from './paper';
import type { Page } from './types';

const A4 = pageDimensions('A4', 'portrait');
const page = (extra: Partial<Page>): Page => ({ id: 'p', notebookId: 'nb', order: 1, ...A4, size: 'A4', template: 'lined', paperColor: '#ffffff', pdf: null, bookmarked: 0, createdAt: 0, updatedAt: 0, ...extra });

describe('Cute Paper', () => {
  it('classic pages keep exactly the old ruling', () => {
    expect(resolveRuling(page({ template: 'lined' }))).toMatchObject({ spacing: 24, color: '#3c5a8c', alpha: 0.22, margin: true });
    expect(resolveRuling(page({ template: 'grid' }))).toMatchObject({ spacing: 18, margin: false });
    expect(resolveRuling(page({ template: 'dotted', paperColor: '#1f2329' }))).toMatchObject({ color: '#ffffff', alpha: 0.16 });
    expect(paperDecor(page({}))).toEqual([]);
  });

  it('ten templates, each with its own paper and lines', () => {
    expect(CUTE_PAPERS).toHaveLength(10);
    for (const c of CUTE_PAPERS) {
      const r = resolveRuling(page({ template: c.template, paperColor: c.paperColor, style: { cute: c.id } }));
      expect(r.color).toBe(c.lineColor);
      expect(r.spacing).toBe(c.spacing);
    }
  });

  it('spacing and line colour can be changed and are clamped', () => {
    expect(resolveRuling(page({ style: { cute: 'lavender', spacing: 30, lineColor: '#8db384' } }))).toMatchObject({ spacing: 30, color: '#8db384' });
    expect(resolveRuling(page({ style: { spacing: 2 } })).spacing).toBe(10);
    expect(resolveRuling(page({ style: { spacing: 999 } })).spacing).toBe(40);
  });

  it('decorations: sakura corners, hearts on the edges, gingham bands; can be switched off', () => {
    for (const id of ['sakura', 'hearts', 'gingham'] as const) {
      const d = paperDecor(page({ template: 'blank', style: { cute: id } }));
      expect(d.length).toBeGreaterThan(0);
      for (const sh of d) expect(sh.d).toMatch(/^M[\d.-]/);
    }
    expect(paperDecor(page({ style: { cute: 'sakura', decor: false } }))).toEqual([]);
    // landscape pages get decorations in their own corners
    const land = pageDimensions('A4', 'landscape');
    expect(paperDecor(page({ ...land, style: { cute: 'sakura' } }))[0]!.d).not.toBe(paperDecor(page({ style: { cute: 'sakura' } }))[0]!.d);
  });

  it('paperKey changes with every visual setting (page caches are refreshed)', () => {
    const keys = new Set([page({}), page({ style: { cute: 'sky' } }), page({ style: { spacing: 20 } }), page({ style: { lineColor: '#e597ad' } }), page({ style: { cute: 'sakura', decor: false } }), page({ style: { cute: 'sakura' } })].map(paperKey));
    expect(keys.size).toBe(6);
  });

  it('PDF export keeps the decorative paper (vector)', async () => {
    const pages = CUTE_PAPERS.map((c, i) => page({ id: `p${i}`, template: c.template, paperColor: c.paperColor, style: { cute: c.id } }));
    const bytes = await exportNotebookPdf(pages, { loadElements: async () => [], getAsset: async () => undefined });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(10);
    // decorated pages carry more drawing operators than a plain one
    expect(bytes.byteLength).toBeGreaterThan(20_000);
  });
});

import { createContext, useContext } from 'react';
import { addPage, deletePage, duplicatePage, getAsset, listPages, loadPageElements, movePage, updatePages } from '@/db/repo';
import { saveQueue } from '@/db/saveQueue';
import { DocumentModel } from '@/engine/DocumentModel';
import type { DrawingEngine, PdfRasterizer } from '@/engine/DrawingEngine';
import { ImageCache } from '@/engine/imageCache';
import { pageDimensions } from '@/model/paper';
import type { Notebook, Page, PageSetup, UUID } from '@/model/types';
import { getPageTextRuns, renderPdfRegion } from '@/pdf/pdfjs';
import type { TextRun } from '@/pdf/textLayer';
import { useEditor } from '@/store/editor';

export const getBlob = async (id: UUID) => (await getAsset(id))?.blob;

/**
 * Everything that lives as long as an open notebook: the in-memory document model, decoded
 * image cache, PDF rasteriser and text-run cache. The engine is attached by the canvas host.
 */
export class EditorSession {
  readonly model: DocumentModel;
  readonly images = new ImageCache(getBlob);
  readonly pdf: PdfRasterizer = {
    render: (page, res, region, signal) => renderPdfRegion(page, res, region, signal, getBlob),
  };
  engine: DrawingEngine | null = null;
  private textRuns = new Map<string, TextRun[] | 'loading'>();

  constructor(readonly notebook: Notebook) {
    this.model = new DocumentModel(
      notebook.id,
      async (pageId) => {
        // A page evicted from memory may still have queued writes; make sure they hit the DB first.
        if (saveQueue.hasPending) await saveQueue.flush().catch(() => {});
        return loadPageElements(pageId);
      },
      saveQueue,
    );
  }

  /** Synchronous text-run lookup for the engine; kicks off loading on a miss. */
  getTextRuns = (page: Page): readonly TextRun[] | null => {
    if (!page.pdf) return null;
    const key = `${page.pdf.assetId}:${page.pdf.pageIndex}`;
    const v = this.textRuns.get(key);
    if (v === 'loading') return null;
    if (v) return v;
    this.textRuns.set(key, 'loading');
    getPageTextRuns(page, getBlob).then(
      (runs) => this.textRuns.set(key, runs),
      () => this.textRuns.set(key, []),
    );
    return null;
  };

  async reloadPages(): Promise<Page[]> {
    const pages = await listPages(this.notebook.id);
    useEditor.setState({ pages });
    this.engine?.setPages(pages);
    return pages;
  }

  private async afterPageOp(): Promise<Page[]> {
    saveQueue.touchNotebook(this.notebook.id);
    return this.reloadPages();
  }

  async addPageAfter(pageId: UUID | null, setup: PageSetup): Promise<number> {
    await saveQueue.flush();
    const page = await addPage(this.notebook.id, pageId, setup);
    const pages = await this.afterPageOp();
    return pages.findIndex((p) => p.id === page.id);
  }

  async duplicatePage(pageId: UUID): Promise<number> {
    await saveQueue.flush();
    const page = await duplicatePage(pageId);
    const pages = await this.afterPageOp();
    return pages.findIndex((p) => p.id === page.id);
  }

  async deletePage(pageId: UUID): Promise<void> {
    await saveQueue.flush();
    await deletePage(pageId);
    this.model.forgetPage(pageId);
    await this.afterPageOp();
    useEditor.setState({ history: { canUndo: this.model.history.canUndo, canRedo: this.model.history.canRedo } });
  }

  async movePage(pageId: UUID, toIndex: number): Promise<void> {
    await movePage(this.notebook.id, pageId, toIndex);
    await this.afterPageOp();
  }

  async toggleBookmark(page: Page): Promise<void> {
    await updatePages([page.id], { bookmarked: page.bookmarked ? 0 : 1 });
    await this.reloadPages();
  }

  /** Applies a page setup to the given pages. PDF pages keep their size (it comes from the file). */
  async applySetup(pageIds: UUID[], setup: PageSetup, pages: Page[]): Promise<void> {
    const { width, height } = pageDimensions(setup.size, setup.orientation);
    const target = new Set(pageIds);
    const plain = pages.filter((p) => target.has(p.id) && !p.pdf).map((p) => p.id);
    const pdf = pages.filter((p) => target.has(p.id) && p.pdf).map((p) => p.id);
    if (plain.length) await updatePages(plain, { template: setup.template, paperColor: setup.paperColor, width, height, size: setup.size });
    if (pdf.length) await updatePages(pdf, { template: setup.template, paperColor: setup.paperColor });
    await this.afterPageOp();
  }

  dispose(): void {
    this.images.clear();
  }
}

export const SessionContext = createContext<EditorSession | null>(null);

export function useSession(): EditorSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('EditorSession missing');
  return s;
}

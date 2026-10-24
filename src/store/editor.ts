import { create } from 'zustand';
import type { SelectionInfo, TextEditRequest, ViewInfo } from '@/engine/DrawingEngine';
import type { Notebook, Page } from '@/model/types';

/**
 * UI-facing editor state. Updated by engine callbacks at low frequency (selection changes,
 * zoom/page changes) — never per pointer sample.
 */
interface EditorState {
  notebook: Notebook | null;
  pages: Page[];
  view: ViewInfo;
  selection: SelectionInfo | null;
  history: { canUndo: boolean; canRedo: boolean };
  textEdit: TextEditRequest | null;
  pagesPanel: boolean;
  focusMode: boolean;
  /** bump to refresh thumbnails of a page */
  pageVersions: Record<string, number>;
  reset(): void;
}

const initial = {
  notebook: null,
  pages: [],
  view: { scale: 1, pageIndex: 0, pageCount: 0 },
  selection: null,
  history: { canUndo: false, canRedo: false },
  textEdit: null,
  pageVersions: {},
};

export const useEditor = create<EditorState>((set) => ({
  ...initial,
  pagesPanel: typeof window !== 'undefined' ? window.innerWidth >= 1100 : false,
  focusMode: false,
  reset() {
    set(initial);
  },
}));

export function bumpPageVersion(pageId: string): void {
  useEditor.setState((s) => ({ pageVersions: { ...s.pageVersions, [pageId]: (s.pageVersions[pageId] ?? 0) + 1 } }));
}

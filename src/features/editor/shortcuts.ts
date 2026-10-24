import { useEffect } from 'react';
import type { ToolKind } from '@/engine/tools';
import { useSession } from '@/editor/session';
import { useEditor } from '@/store/editor';
import { useSettings } from '@/store/settings';

const TOOL_KEYS: Record<string, ToolKind> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', s: 'shape', t: 'text' };

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/** Desktop / hardware keyboard shortcuts for the editor. */
export function useEditorShortcuts(): void {
  const session = useSession();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const engine = session.engine;
      if (!engine) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.code === 'Space' && !e.repeat) {
        engine.setSpacePan(true);
        e.preventDefault();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        engine.redo();
      } else if (mod && key === 'c') {
        if (engine.copySelection()) e.preventDefault();
      } else if (mod && key === 'x') {
        e.preventDefault();
        engine.cutSelection();
      } else if (mod && key === 'v') {
        if (engine.hasClipboard) {
          e.preventDefault();
          engine.paste();
        }
      } else if (mod && key === 'a') {
        e.preventDefault();
        useSettings.getState().updateTools((t) => ({ ...t, tool: 'lasso' }));
        engine.selectAll();
      } else if (mod && key === 'd') {
        e.preventDefault();
        engine.duplicateSelection();
      } else if ((key === 'delete' || key === 'backspace') && engine.hasSelection) {
        e.preventDefault();
        engine.deleteSelection();
      } else if (key === 'escape') {
        engine.clearSelection();
        if (useEditor.getState().focusMode) useEditor.setState({ focusMode: false });
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        engine.zoomBy(1.25);
      } else if (mod && key === '-') {
        e.preventDefault();
        engine.zoomBy(0.8);
      } else if (mod && key === '0') {
        e.preventDefault();
        engine.fitWidth();
      } else if (key === 'pagedown') {
        e.preventDefault();
        engine.scrollToPage(engine.currentPageIndex() + 1);
      } else if (key === 'pageup') {
        e.preventDefault();
        engine.scrollToPage(engine.currentPageIndex() - 1);
      } else if (e.shiftKey && key === 'p') {
        const s = useSettings.getState();
        s.set('showPerf', !s.showPerf);
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        const tool = TOOL_KEYS[key]!;
        useSettings.getState().updateTools((t) => ({ ...t, tool }));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') session.engine?.setSpacePan(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [session]);
}

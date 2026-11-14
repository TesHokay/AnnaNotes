import { useEffect, useRef } from 'react';
import { rememberNotebookPage } from '@/db/repo';
import { DrawingEngine } from '@/engine/DrawingEngine';
import { setEditorBusyProbe } from '@/editor/busy';
import { useSession } from '@/editor/session';
import { bumpPageVersion, useEditor } from '@/store/editor';
import { toolConfigFrom, useSettings } from '@/store/settings';
import { toast } from '@/store/ui';

function readCanvasColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  return v ? `hsl(${v})` : '#e5e5ea';
}

/**
 * Mounts the drawing engine. React never re-renders this component during drawing: tool and
 * settings changes are pushed into the engine through store subscriptions.
 */
export function CanvasHost() {
  const ref = useRef<HTMLDivElement>(null);
  const session = useSession();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settings = useSettings.getState();
    const versionTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let rememberedPageId = session.notebook.lastPageId;
    const rememberPage = () => {
      const pageId = engine.currentPageId();
      if (!pageId || pageId === rememberedPageId) return;
      rememberedPageId = pageId;
      session.notebook.lastPageId = pageId;
      void rememberNotebookPage(session.notebook.id, pageId).catch(() => {
        // Retry on the next view change or when leaving the editor.
        if (rememberedPageId === pageId) rememberedPageId = undefined;
      });
    };
    const engine = new DrawingEngine(el, {
      model: session.model,
      images: session.images,
      pdf: session.pdf,
      config: toolConfigFrom(settings),
      stylusOnly: settings.stylusOnly,
      textRuns: session.getTextRuns,
      callbacks: {
        onContextMenu: (contextMenu) => useEditor.setState({ contextMenu }),
        onViewChange: (view) => {
          useEditor.setState({ view });
          rememberPage();
        },
        onSelectionChange: (selection) => useEditor.setState({ selection }),
        onHistoryChange: (history) => {
          const cur = useEditor.getState().history;
          if (cur.canUndo !== history.canUndo || cur.canRedo !== history.canRedo) useEditor.setState({ history });
        },
        onTextEdit: (textEdit) => useEditor.setState({ textEdit }),
        onContentChange: (pageId) => {
          // Thumbnails refresh shortly after editing stops.
          const t = versionTimers.get(pageId);
          if (t) clearTimeout(t);
          versionTimers.set(
            pageId,
            setTimeout(() => bumpPageVersion(pageId), 900),
          );
        },
        onError: (message) => toast(message, { kind: 'error' }),
      },
    });
    session.engine = engine;
    // Debug handle for development only (inspect perf/state from the console or automation).
    if (import.meta.env.DEV) (window as unknown as { __engine?: DrawingEngine }).__engine = engine;
    engine.setCanvasColor(readCanvasColor());
    const pages = useEditor.getState().pages;
    if (pages.length) {
      engine.setPages(pages);
      const index = pages.findIndex((page) => page.id === session.notebook.lastPageId);
      if (index >= 0) engine.scrollToPage(index);
    }
    setEditorBusyProbe(() => engine.isInteracting);

    const unsubSettings = useSettings.subscribe((s, prev) => {
      if (s.tools !== prev.tools || s.smoothing !== prev.smoothing || s.calibration !== prev.calibration) engine.setConfig(toolConfigFrom(s));
      if (s.stylusOnly !== prev.stylusOnly) engine.setStylusOnly(s.stylusOnly);
      if (s.themeId !== prev.themeId) requestAnimationFrame(() => engine.setCanvasColor(readCanvasColor()));
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => requestAnimationFrame(() => engine.setCanvasColor(readCanvasColor()));
    mq.addEventListener('change', onScheme);
    // iOS kills background PWAs that hold a lot of memory: drop bitmaps while hidden.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        rememberPage();
        engine.releaseCaches();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', rememberPage);

    return () => {
      rememberPage();
      unsubSettings();
      mq.removeEventListener('change', onScheme);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', rememberPage);
      for (const t of versionTimers.values()) clearTimeout(t);
      setEditorBusyProbe(() => false);
      engine.destroy();
      session.engine = null;
    };
  }, [session]);

  return <div ref={ref} className="drawing-surface absolute inset-0 overflow-hidden" />;
}

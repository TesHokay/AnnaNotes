import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronLeft,
  CloudOff,
  Download,
  FileDown,
  FileImage,
  Fingerprint,
  Loader2,
  Maximize,
  Minimize,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Redo2,
  Settings,
  StickyNote,
  Undo2,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { StatusBanners } from '@/components/app/StatusBanners';
import { getDB } from '@/db/db';
import { markOpened, renameNotebook } from '@/db/repo';
import { saveQueue } from '@/db/saveQueue';
import { EditorSession, SessionContext, useSession } from '@/editor/session';
import { exportNotebookAsPdf, exportNotebookBackup, exportPageAsPng } from '@/features/actions';
import { NameDialog } from '@/features/library/dialogs';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { useLive } from '@/lib/useLive';
import { cn } from '@/lib/utils';
import type { Notebook } from '@/model/types';
import { closeAllPdfs } from '@/pdf/pdfjs';
import { useEditor } from '@/store/editor';
import { useSettings } from '@/store/settings';
import { errorMessage, navigate, toast, useUI } from '@/store/ui';
import { CanvasHost } from './CanvasHost';
import { PageSettingsDialog } from './PageSettingsDialog';
import { PagesPanel } from './PagesPanel';
import { PerfOverlay, SelectionBar, TextEditorOverlay, ZoomControls } from './overlays';
import { Toolbar } from './Toolbar';
import { useEditorShortcuts } from './shortcuts';

export function EditorView({ id }: { id: string }) {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let s: EditorSession | null = null;
    useEditor.getState().reset();
    setSession(null);
    setError(null);
    (async () => {
      const nb = await getDB().notebooks.get(id);
      if (!nb || nb.deletedAt) throw new Error('Документ не найден или находится в корзине');
      if (cancelled) return;
      s = new EditorSession(nb);
      useEditor.setState({ notebook: nb });
      await s.reloadPages();
      await markOpened(id).catch(() => {});
      const tabs = useSettings.getState().openTabs;
      if (!tabs.includes(id)) useSettings.getState().set('openTabs', [...tabs, id].slice(-8));
      if (!cancelled) setSession(s);
    })().catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      // Leaving the notebook: persist everything that is queued.
      void saveQueue.flush().catch(() => {});
      s?.dispose();
      closeAllPdfs();
    };
  }, [id]);

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-[15px]">{error}</p>
        <Button onClick={() => navigate({ name: 'library' })}>К библиотеке</Button>
      </div>
    );
  if (!session)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  return (
    <SessionContext.Provider value={session}>
      <EditorLayout />
    </SessionContext.Provider>
  );
}

function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const on = () => setCompact(window.innerWidth < 640);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return compact;
}

function EditorLayout() {
  const pagesPanel = useEditor((s) => s.pagesPanel);
  const focusMode = useEditor((s) => s.focusMode);
  const compact = useIsCompact();
  useEditorShortcuts();

  const exitFocus = () => {
    useEditor.setState({ focusMode: false });
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      {!focusMode && (
        <div className="pt-safe pl-safe pr-safe glass z-20 border-b">
          <TopBar compact={compact} />
          {!compact && <Toolbar />}
        </div>
      )}
      {!focusMode && <StatusBanners compact />}
      <div className="relative flex min-h-0 flex-1">
        {pagesPanel && !focusMode && !compact && <PagesPanel />}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <CanvasHost />
          <SelectionBar />
          <TextEditorOverlay />
          <ZoomControls />
          <PerfOverlay />
          {focusMode && (
            <button onClick={exitFocus} className="glass absolute right-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 grid h-11 w-11 place-items-center rounded-full border shadow-soft" aria-label="Выйти из полноэкранного режима">
              <Minimize className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {compact && !focusMode && (
        <div className="pb-safe glass z-20 border-t">
          <Toolbar compact />
        </div>
      )}
    </div>
  );
}

function SaveIndicator() {
  const save = useUI((s) => s.save);
  const online = useUI((s) => s.online);
  const map = {
    idle: { icon: <Check className="h-4 w-4" />, text: 'Сохранено', cls: 'text-muted-foreground' },
    saved: { icon: <Check className="h-4 w-4" />, text: 'Сохранено', cls: 'text-muted-foreground' },
    pending: { icon: <Loader2 className="h-4 w-4 animate-spin" />, text: 'Сохранение…', cls: 'text-muted-foreground' },
    saving: { icon: <Loader2 className="h-4 w-4 animate-spin" />, text: 'Сохранение…', cls: 'text-muted-foreground' },
    error: { icon: <AlertCircle className="h-4 w-4" />, text: 'Ошибка', cls: 'text-destructive' },
    quota: { icon: <AlertCircle className="h-4 w-4" />, text: 'Нет места', cls: 'text-destructive' },
  }[save.status];
  return (
    <div className={cn('hidden items-center gap-1.5 px-2 text-[12px] md:flex', map.cls)} role="status" aria-live="polite" data-testid="save-status" data-status={save.status}>
      {!online && <CloudOff className="h-4 w-4" aria-label="Офлайн" />}
      {map.icon}
      <span>{map.text}</span>
    </div>
  );
}

function Tabs({ current }: { current: Notebook }) {
  const tabIds = useSettings((s) => s.openTabs);
  const setSetting = useSettings((s) => s.set);
  const notebooks = useLive(() => getDB().notebooks.bulkGet(tabIds), [tabIds.join(',')]);
  const tabs = useMemo(() => (notebooks ?? []).filter((n): n is Notebook => !!n && !n.deletedAt), [notebooks]);
  if (tabs.length < 2) return null;
  const close = (id: string) => {
    const rest = tabIds.filter((t) => t !== id);
    setSetting('openTabs', rest);
    if (id === current.id) navigate(rest.length ? { name: 'notebook', id: rest[rest.length - 1]! } : { name: 'library' });
  };
  return (
    <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none lg:flex" role="tablist">
      {tabs.map((t) => (
        <div key={t.id} className={cn('group flex h-9 max-w-[200px] shrink-0 items-center rounded-full pl-3 pr-1 text-[13px]', t.id === current.id ? 'bg-surface font-medium shadow-soft' : 'text-muted-foreground hover:bg-muted')} role="tab" aria-selected={t.id === current.id}>
          <button className="truncate" onClick={() => navigate({ name: 'notebook', id: t.id })}>
            {t.title}
          </button>
          <button className="ml-1 grid h-7 w-7 place-items-center rounded-full opacity-60 hover:bg-muted hover:opacity-100" onClick={() => close(t.id)} aria-label={`Закрыть вкладку ${t.title}`}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TopBar({ compact }: { compact: boolean }) {
  const session = useSession();
  const notebook = useEditor((s) => s.notebook)!;
  const history = useEditor((s) => s.history);
  const pages = useEditor((s) => s.pages);
  const pageIndex = useEditor((s) => s.view.pageIndex);
  const pagesPanel = useEditor((s) => s.pagesPanel);
  const stylusOnly = useSettings((s) => s.stylusOnly);
  const setSetting = useSettings((s) => s.set);
  const [rename, setRename] = useState(false);
  const [pageSettings, setPageSettings] = useState(false);
  const [settings, setSettings] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const currentPage = pages[pageIndex];

  const runExport = async (label: string, fn: () => Promise<void>) => {
    setExporting(label);
    try {
      await fn();
    } catch (err) {
      toast(`Не удалось экспортировать: ${errorMessage(err)}`, { kind: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const enterFocus = () => {
    useEditor.setState({ focusMode: true });
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) void el.requestFullscreen().catch(() => {});
  };

  const addPage = async () => {
    try {
      const p = currentPage;
      const setup = p && !p.pdf ? { ...notebook.defaultSetup, template: p.template, paperColor: p.paperColor, orientation: p.width > p.height ? ('landscape' as const) : ('portrait' as const), size: p.size === 'custom' ? notebook.defaultSetup.size : p.size } : notebook.defaultSetup;
      const idx = await session.addPageAfter(p?.id ?? null, setup);
      session.engine?.scrollToPage(idx);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  return (
    <div className="flex h-14 items-center gap-1 px-2">
      <IconButton label="Библиотека" onClick={() => navigate({ name: 'library' })} data-testid="back">
        <ChevronLeft className="h-6 w-6" />
      </IconButton>
      {!compact && (
        <IconButton label="Страницы" active={pagesPanel} onClick={() => useEditor.setState({ pagesPanel: !pagesPanel })}>
          <PanelLeft className="h-5 w-5" />
        </IconButton>
      )}
      <button className="min-w-0 max-w-[40vw] truncate rounded-md px-2 py-1 text-left text-[16px] font-semibold hover:bg-muted lg:max-w-[220px]" onClick={() => setRename(true)} title="Переименовать">
        {notebook.title}
      </button>
      <Tabs current={notebook} />
      <div className="ml-auto flex items-center gap-0.5">
        <SaveIndicator />
        <IconButton label="Отменить (Ctrl+Z)" disabled={!history.canUndo} onClick={() => session.engine?.undo()} data-testid="undo">
          <Undo2 className="h-5 w-5" />
        </IconButton>
        <IconButton label="Повторить (Ctrl+Shift+Z)" disabled={!history.canRedo} onClick={() => session.engine?.redo()} data-testid="redo">
          <Redo2 className="h-5 w-5" />
        </IconButton>
        <IconButton label="Добавить страницу" onClick={() => void addPage()}>
          <Plus className="h-5 w-5" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Экспорт" disabled={!!exporting} data-testid="export-menu">
              {exporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void runExport('pdf', () => exportNotebookAsPdf(notebook))} data-testid="export-pdf">
              <FileDown /> Экспорт в PDF
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void runExport('png', () => exportPageAsPng(notebook, pageIndex))}>
              <FileImage /> Страница {pageIndex + 1} в PNG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void runExport('backup', () => exportNotebookBackup(notebook))}>
              <Download /> Резервная копия тетради
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Ещё">
              <MoreHorizontal className="h-5 w-5" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setPageSettings(true)}>
              <StickyNote /> Шаблон и бумага
            </DropdownMenuItem>
            {currentPage && (
              <DropdownMenuItem onSelect={() => void session.toggleBookmark(currentPage)}>
                <Bookmark /> {currentPage.bookmarked ? 'Убрать закладку' : 'Закладка на странице'}
              </DropdownMenuItem>
            )}
            <DropdownMenuCheckboxItem checked={!stylusOnly} onCheckedChange={(v) => setSetting('stylusOnly', !v)}>
              <Fingerprint className="mr-3 inline h-[18px] w-[18px] text-muted-foreground" />
              Рисовать пальцем
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={enterFocus}>
              <Maximize /> Полноэкранный режим
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSettings(true)}>
              <Settings /> Настройки
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NameDialog
        open={rename}
        title="Переименовать"
        initial={notebook.title}
        confirmLabel="Сохранить"
        onClose={() => setRename(false)}
        onSubmit={(v) => {
          setRename(false);
          void renameNotebook(notebook.id, v)
            .then(() => useEditor.setState({ notebook: { ...notebook, title: v.trim() || 'Без названия' } }))
            .catch((err) => toast(errorMessage(err), { kind: 'error' }));
        }}
      />
      <PageSettingsDialog open={pageSettings} onOpenChange={setPageSettings} />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}

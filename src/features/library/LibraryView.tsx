import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Download,
  FileDown,
  FilePlus2,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  List,
  Menu,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { StatusBanners } from '@/components/app/StatusBanners';
import { getDB } from '@/db/db';
import {
  createFolder,
  createNotebook,
  deleteFolder,
  deleteNotebooksPermanently,
  duplicateNotebook,
  emptyTrash,
  moveFolder,
  moveNotebooks,
  renameFolder,
  renameNotebook,
  restoreNotebooks,
  setFavorite,
  trashNotebooks,
} from '@/db/repo';
import { exportNotebookAsPdf, exportNotebookBackup, readBackupFile } from '@/features/actions';
import { runImport } from '@/features/import/importQueue';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { RestoreDialog } from '@/features/settings/RestoreDialog';
import type { ParsedBackup } from '@/backup/backup';
import { pickFiles } from '@/lib/files';
import { useLive } from '@/lib/useLive';
import { cn, formatDate, pluralRu } from '@/lib/utils';
import type { Folder, Notebook, UUID } from '@/model/types';
import { useSettings, type SortKey } from '@/store/settings';
import { errorMessage, navigate, toast } from '@/store/ui';
import { ConfirmDialog, MoveDialog, NameDialog, NewNotebookDialog } from './dialogs';
import { NotebookCover } from './NotebookCover';

type Section = { kind: 'all' } | { kind: 'recent' } | { kind: 'favorites' } | { kind: 'trash' } | { kind: 'folder'; id: UUID };

const SORT_LABELS: Record<SortKey, string> = { updated: 'Дата изменения', opened: 'Дата открытия', created: 'Дата создания', title: 'Название' };

function sortNotebooks(list: Notebook[], key: SortKey): Notebook[] {
  const s = [...list];
  if (key === 'title') return s.sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
  if (key === 'created') return s.sort((a, b) => b.createdAt - a.createdAt);
  if (key === 'opened') return s.sort((a, b) => b.openedAt - a.openedAt);
  return s.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function guarded(fn: () => Promise<unknown>, success?: string): Promise<void> {
  try {
    await fn();
    if (success) toast(success, { kind: 'success' });
  } catch (err) {
    toast(errorMessage(err), { kind: 'error' });
  }
}

/** Long-press (touch) or right-click opens the context menu of an item. */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    fired,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        fired.current = false;
        if (e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, 480);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        onLong();
      },
    },
  };
}

export function LibraryView() {
  const notebooks = useLive(() => getDB().notebooks.toArray(), []);
  const folders = useLive(() => getDB().folders.toArray(), []);
  const view = useSettings((s) => s.libraryView);
  const sort = useSettings((s) => s.sort);
  const setSetting = useSettings((s) => s.set);

  const [section, setSection] = useState<Section>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<UUID>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newNotebook, setNewNotebook] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ title: string; initial: string; confirm: string; submit: (v: string) => void } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ notebookIds?: UUID[]; folderId?: UUID } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description?: string; label: string; run: () => void } | null>(null);
  const [restore, setRestore] = useState<ParsedBackup | null>(null);

  const currentFolderId = section.kind === 'folder' ? section.id : null;
  const folderList = folders ?? [];
  const folderById = useMemo(() => new Map(folderList.map((f) => [f.id, f])), [folderList]);

  const visible = useMemo(() => {
    if (!notebooks) return [];
    let list = notebooks.filter((n) => (section.kind === 'trash' ? n.deletedAt > 0 : n.deletedAt === 0));
    if (section.kind === 'favorites') list = list.filter((n) => n.favorite);
    if (section.kind === 'folder') list = list.filter((n) => n.folderId === section.id);
    const q = query.trim().toLocaleLowerCase('ru');
    if (q) list = list.filter((n) => n.title.toLocaleLowerCase('ru').includes(q));
    if (section.kind === 'recent') return list.filter((n) => n.openedAt > 0).sort((a, b) => b.openedAt - a.openedAt).slice(0, 30);
    return sortNotebooks(list, sort);
  }, [notebooks, section, query, sort]);

  const subfolders = useMemo(
    () => (section.kind === 'folder' || section.kind === 'all' ? folderList.filter((f) => f.parentId === currentFolderId).sort((a, b) => a.name.localeCompare(b.name, 'ru')) : []),
    [folderList, section, currentFolderId],
  );

  const sectionTitle =
    section.kind === 'all' ? 'Все документы' : section.kind === 'recent' ? 'Недавние' : section.kind === 'favorites' ? 'Избранное' : section.kind === 'trash' ? 'Корзина' : (folderById.get(section.id)?.name ?? 'Папка');

  const breadcrumbs = useMemo(() => {
    if (section.kind !== 'folder') return [];
    const out: Folder[] = [];
    let cur = folderById.get(section.id);
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
    }
    return out;
  }, [section, folderById]);

  const open = (nb: Notebook) => {
    if (nb.deletedAt) return;
    navigate({ name: 'notebook', id: nb.id });
  };

  const toggleSelect = (id: UUID) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const doImport = async () => {
    const files = await pickFiles('application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg,.zip,application/zip,.goodnotes', true);
    if (!files.length) return;
    try {
      await runImport(files, currentFolderId);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  const doRestore = async () => {
    const [file] = await pickFiles('.annanotes,.pencilnotes,.zip,application/zip');
    if (!file) return;
    try {
      setRestore(await readBackupFile(file));
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  const notebookMenu = (nb: Notebook) =>
    nb.deletedAt ? (
      <>
        <DropdownMenuItem onSelect={() => void guarded(() => restoreNotebooks([nb.id]), 'Документ восстановлен')}>
          <RotateCcw /> Восстановить
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={() => setConfirm({ title: `Удалить «${nb.title}» навсегда?`, description: 'Документ и все его страницы будут удалены без возможности восстановления.', label: 'Удалить', run: () => void guarded(() => deleteNotebooksPermanently([nb.id])) })}
        >
          <Trash2 /> Удалить навсегда
        </DropdownMenuItem>
      </>
    ) : (
      <>
        <DropdownMenuItem onSelect={() => open(nb)}>
          <BookOpen /> Открыть
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setNameDialog({ title: 'Переименовать', initial: nb.title, confirm: 'Сохранить', submit: (v) => void guarded(() => renameNotebook(nb.id, v)) })}>
          <Pencil /> Переименовать
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void guarded(() => setFavorite([nb.id], !nb.favorite))}>
          <Star /> {nb.favorite ? 'Убрать из избранного' : 'В избранное'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void guarded(() => duplicateNotebook(nb.id), 'Создана копия')}>
          <Copy /> Дублировать
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMoveTarget({ notebookIds: [nb.id] })}>
          <FolderInput /> Переместить
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void guarded(() => exportNotebookAsPdf(nb))}>
          <FileDown /> Экспорт PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void guarded(() => exportNotebookBackup(nb))}>
          <Download /> Резервная копия
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void guarded(() => trashNotebooks([nb.id]), 'Перемещено в корзину')}>
          <Trash2 /> В корзину
        </DropdownMenuItem>
      </>
    );

  const folderMenu = (f: Folder) => (
    <>
      <DropdownMenuItem onSelect={() => setNameDialog({ title: 'Переименовать папку', initial: f.name, confirm: 'Сохранить', submit: (v) => void guarded(() => renameFolder(f.id, v)) })}>
        <Pencil /> Переименовать
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setNameDialog({ title: 'Новая вложенная папка', initial: '', confirm: 'Создать', submit: (v) => void guarded(() => createFolder(v, f.id)) })}>
        <FolderPlus /> Вложенная папка
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setMoveTarget({ folderId: f.id })}>
        <FolderInput /> Переместить
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        destructive
        onSelect={() =>
          setConfirm({
            title: `Удалить папку «${f.name}»?`,
            description: 'Документы и вложенные папки не удаляются — они переместятся на уровень выше.',
            label: 'Удалить папку',
            run: () =>
              void guarded(async () => {
                await deleteFolder(f.id);
                if (section.kind === 'folder' && section.id === f.id) setSection(f.parentId ? { kind: 'folder', id: f.parentId } : { kind: 'all' });
              }),
          })
        }
      >
        <Trash2 /> Удалить папку
      </DropdownMenuItem>
    </>
  );

  const loading = notebooks === undefined;
  const ids = [...selected];

  return (
    <div className="flex h-full">
      {/* Sidebar: persistent on wide screens, drawer on narrow ones */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/25 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside
        className={cn(
          'pt-safe pl-safe fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-surface/95 backdrop-blur-xl transition-transform duration-200 lg:static lg:translate-x-0 lg:bg-surface/60',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-primary text-primary-foreground">
            <Pencil className="h-4 w-4" />
          </div>
          <span className="text-[17px] font-semibold">AnnaNotes</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Разделы">
          {(
            [
              { s: { kind: 'all' }, icon: BookOpen, label: 'Все документы' },
              { s: { kind: 'recent' }, icon: Clock, label: 'Недавние' },
              { s: { kind: 'favorites' }, icon: Star, label: 'Избранное' },
              { s: { kind: 'trash' }, icon: Trash2, label: 'Корзина' },
            ] as const
          ).map(({ s, icon: Icon, label }) => (
            <SideItem
              key={s.kind}
              active={section.kind === s.kind}
              onClick={() => {
                setSection(s);
                setSidebarOpen(false);
                exitSelect();
              }}
            >
              <Icon className="h-5 w-5" /> {label}
            </SideItem>
          ))}
          <div className="mt-5 flex items-center justify-between px-3 pb-1">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Папки</span>
            <IconButton
              label="Новая папка"
              size="icon-sm"
              onClick={() => setNameDialog({ title: 'Новая папка', initial: '', confirm: 'Создать', submit: (v) => void guarded(() => createFolder(v, null)) })}
            >
              <FolderPlus className="h-4 w-4" />
            </IconButton>
          </div>
          <FolderTree
            folders={folderList}
            parent={null}
            depth={0}
            activeId={currentFolderId}
            onOpen={(id) => {
              setSection({ kind: 'folder', id });
              setSidebarOpen(false);
              exitSelect();
            }}
          />
          {folderList.length === 0 && <p className="px-3 py-2 text-[13px] text-muted-foreground">Папок пока нет</p>}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe pr-safe glass sticky top-0 z-20 border-b">
          <div className="flex h-14 items-center gap-1 px-2 sm:px-4">
            <IconButton label="Меню" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </IconButton>
            {selecting ? (
              <>
                <IconButton label="Готово" onClick={exitSelect}>
                  <X className="h-5 w-5" />
                </IconButton>
                <span className="text-[17px] font-semibold">
                  Выбрано: {selected.size}
                </span>
              </>
            ) : (
              <h1 className="min-w-0 truncate text-[20px] font-bold tracking-tight sm:text-[22px]">{sectionTitle}</h1>
            )}
            <div className="ml-auto flex items-center gap-1">
              {!selecting && (
                <div className="relative hidden sm:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="h-9 w-48 rounded-full bg-muted pl-9 lg:w-64" aria-label="Поиск по названию" />
                </div>
              )}
              {selecting ? (
                <SelectionActions
                  ids={ids}
                  trash={section.kind === 'trash'}
                  onMove={() => setMoveTarget({ notebookIds: ids })}
                  onDone={exitSelect}
                  onConfirm={setConfirm}
                  allIds={visible.map((n) => n.id)}
                  onSelectAll={(all) => setSelected(new Set(all))}
                />
              ) : (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label="Сортировка и вид">
                        <ArrowDownUp className="h-5 w-5" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Сортировка</DropdownMenuLabel>
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                        <DropdownMenuCheckboxItem key={k} checked={sort === k} onCheckedChange={() => setSetting('sort', k)}>
                          {SORT_LABELS[k]}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <IconButton label={view === 'grid' ? 'Список' : 'Сетка'} onClick={() => setSetting('libraryView', view === 'grid' ? 'list' : 'grid')}>
                    {view === 'grid' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
                  </IconButton>
                  <Button variant="ghost" size="sm" className="px-2.5 text-primary" onClick={() => setSelecting(true)} disabled={!visible.length}>
                    Выбрать
                  </Button>
                  <IconButton label="Настройки" onClick={() => setSettingsOpen(true)}>
                    <Settings className="h-5 w-5" />
                  </IconButton>
                  {section.kind !== 'trash' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" className="ml-1 rounded-full px-3.5" data-testid="new-menu">
                          <FilePlus2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Новый</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setNewNotebook(true)}>
                          <BookOpen /> Тетрадь
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setNameDialog({ title: 'Новая папка', initial: '', confirm: 'Создать', submit: (v) => void guarded(() => createFolder(v, currentFolderId)) })}
                        >
                          <FolderPlus /> Папка
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void doImport()}>
                          <Upload /> Импорт PDF, изображений, ZIP
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void doRestore()}>
                          <RotateCcw /> Восстановить из копии
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </div>
          </div>
          {!selecting && (
            <div className="px-3 pb-2 sm:hidden">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="h-9 rounded-full bg-muted pl-9" aria-label="Поиск по названию" />
              </div>
            </div>
          )}
        </header>

        <StatusBanners />

        <div className="pb-safe pr-safe flex-1 overflow-y-auto px-4 pt-4 sm:px-6">
          {breadcrumbs.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1 text-[14px] text-muted-foreground">
              {breadcrumbs.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  {i > 0 && <span>/</span>}
                  <button className="hover:text-foreground" onClick={() => setSection({ kind: 'folder', id: f.id })}>
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}
          {section.kind === 'trash' && visible.length > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-md bg-muted px-4 py-2.5 text-[14px] text-muted-foreground">
              Документы в корзине можно восстановить.
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirm({ title: 'Очистить корзину?', description: 'Все документы в корзине будут удалены навсегда.', label: 'Очистить', run: () => void guarded(emptyTrash) })}
              >
                Очистить
              </Button>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : visible.length === 0 && subfolders.length === 0 ? (
            <EmptyState section={section} query={query} onCreate={() => setNewNotebook(true)} onImport={() => void doImport()} />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-7 pb-10 sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]">
              {subfolders.map((f) => (
                <FolderTile key={f.id} folder={f} onOpen={() => setSection({ kind: 'folder', id: f.id })} menu={folderMenu(f)} count={(notebooks ?? []).filter((n) => n.folderId === f.id && !n.deletedAt).length} />
              ))}
              {visible.map((nb) => (
                <NotebookItem key={nb.id} nb={nb} layout="grid" selecting={selecting} selected={selected.has(nb.id)} onOpen={() => (selecting ? toggleSelect(nb.id) : open(nb))} menu={notebookMenu(nb)} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col pb-10">
              {subfolders.map((f) => (
                <FolderTile key={f.id} folder={f} list onOpen={() => setSection({ kind: 'folder', id: f.id })} menu={folderMenu(f)} count={(notebooks ?? []).filter((n) => n.folderId === f.id && !n.deletedAt).length} />
              ))}
              {visible.map((nb) => (
                <NotebookItem key={nb.id} nb={nb} layout="list" selecting={selecting} selected={selected.has(nb.id)} onOpen={() => (selecting ? toggleSelect(nb.id) : open(nb))} menu={notebookMenu(nb)} />
              ))}
            </div>
          )}
        </div>
      </main>

      <NewNotebookDialog
        open={newNotebook}
        onClose={() => setNewNotebook(false)}
        onCreate={async (v) => {
          setNewNotebook(false);
          try {
            const nb = await createNotebook({ title: v.title, coverColor: v.coverColor, setup: v.setup, folderId: currentFolderId });
            navigate({ name: 'notebook', id: nb.id });
          } catch (err) {
            toast(errorMessage(err), { kind: 'error' });
          }
        }}
      />
      <NameDialog
        open={!!nameDialog}
        title={nameDialog?.title ?? ''}
        initial={nameDialog?.initial ?? ''}
        confirmLabel={nameDialog?.confirm ?? 'OK'}
        onClose={() => setNameDialog(null)}
        onSubmit={(v) => {
          nameDialog?.submit(v);
          setNameDialog(null);
        }}
      />
      <MoveDialog
        open={!!moveTarget}
        folders={folderList}
        exclude={moveTarget?.folderId}
        onClose={() => setMoveTarget(null)}
        onMove={(folderId) => {
          const t = moveTarget;
          setMoveTarget(null);
          if (t?.notebookIds) void guarded(() => moveNotebooks(t.notebookIds!, folderId), 'Перемещено').then(exitSelect);
          if (t?.folderId) void guarded(() => moveFolder(t.folderId!, folderId), 'Папка перемещена');
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? 'OK'}
        destructive
        onConfirm={() => confirm?.run()}
        onClose={() => setConfirm(null)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <RestoreDialog parsed={restore} onClose={() => setRestore(null)} />
    </div>
  );
}

function SideItem({ active, onClick, children, style }: { active?: boolean; onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={cn('flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] transition-colors [&_svg]:shrink-0', active ? 'bg-primary text-primary-foreground [&_svg]:text-primary-foreground' : 'hover:bg-muted [&_svg]:text-primary')}
    >
      {children}
    </button>
  );
}

function FolderTree({ folders, parent, depth, activeId, onOpen }: { folders: Folder[]; parent: UUID | null; depth: number; activeId: UUID | null; onOpen: (id: UUID) => void }) {
  const items = folders.filter((f) => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return (
    <>
      {items.map((f) => (
        <div key={f.id}>
          <SideItem active={activeId === f.id} onClick={() => onOpen(f.id)} style={{ paddingLeft: 12 + depth * 16 }}>
            <FolderIcon className="h-5 w-5" />
            <span className="truncate">{f.name}</span>
          </SideItem>
          <FolderTree folders={folders} parent={f.id} depth={depth + 1} activeId={activeId} onOpen={onOpen} />
        </div>
      ))}
    </>
  );
}

function FolderTile({ folder, onOpen, menu, count, list }: { folder: Folder; onOpen: () => void; menu: React.ReactNode; count: number; list?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lp = useLongPress(() => setMenuOpen(true));
  const menuEl = (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton label="Действия с папкой" size="icon-sm">
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
    </DropdownMenu>
  );
  if (list) {
    return (
      <div className="flex min-h-14 items-center gap-3 border-b px-1" {...lp.handlers}>
        <button className="flex flex-1 items-center gap-3 text-left" onClick={() => !lp.fired.current && onOpen()}>
          <FolderIcon className="h-8 w-8 fill-primary/15 text-primary" />
          <span className="flex-1 truncate text-[15px] font-medium">{folder.name}</span>
          <span className="text-[13px] text-muted-foreground">{count}</span>
        </button>
        {menuEl}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" {...lp.handlers}>
      <button onClick={() => !lp.fired.current && onOpen()} className="grid aspect-[3/4] w-full place-items-center rounded-lg bg-accent/60 transition-transform active:scale-[0.98]" aria-label={`Папка ${folder.name}`}>
        <FolderIcon className="h-16 w-16 fill-primary/20 text-primary" strokeWidth={1.4} />
      </button>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{folder.name}</div>
          <div className="text-[12px] text-muted-foreground">
            {count} {pluralRu(count, 'документ', 'документа', 'документов')}
          </div>
        </div>
        {menuEl}
      </div>
    </div>
  );
}

function NotebookItem({ nb, layout, selecting, selected, onOpen, menu }: { nb: Notebook; layout: 'grid' | 'list'; selecting: boolean; selected: boolean; onOpen: () => void; menu: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lp = useLongPress(() => !selecting && setMenuOpen(true));
  const meta = `${formatDate(nb.updatedAt)} · ${nb.pageCount} ${pluralRu(nb.pageCount, 'стр.', 'стр.', 'стр.')}`;
  const check = selecting && (selected ? <CheckCircle2 className="h-6 w-6 fill-primary text-primary-foreground" /> : <Circle className="h-6 w-6 text-muted-foreground" />);
  const menuEl = !selecting && (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Действия: ${nb.title}`} size="icon-sm">
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
    </DropdownMenu>
  );
  if (layout === 'list') {
    return (
      <div className={cn('flex min-h-16 items-center gap-3 border-b px-1', selected && 'bg-accent/50')} {...lp.handlers}>
        {check}
        <button className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left" onClick={() => !lp.fired.current && onOpen()} data-testid="notebook-item">
          <NotebookCover nb={nb} className="w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-[15px] font-medium">
              {nb.title}
              {nb.favorite ? <Star className="h-3.5 w-3.5 shrink-0 fill-[#ffcc00] text-[#ffcc00]" /> : null}
            </div>
            <div className="text-[13px] text-muted-foreground">{meta}</div>
          </div>
        </button>
        {menuEl}
      </div>
    );
  }
  return (
    <div className="group flex flex-col gap-2" {...lp.handlers}>
      <button
        onClick={() => !lp.fired.current && onOpen()}
        className={cn('relative rounded-lg p-1 transition-transform duration-150 active:scale-[0.97]', selected && 'bg-accent ring-2 ring-primary')}
        aria-label={nb.title}
        data-testid="notebook-item"
      >
        <NotebookCover nb={nb} />
        {selecting && <span className="absolute bottom-3 right-3">{check}</span>}
        {nb.favorite ? <Star className="absolute right-3 top-3 h-4 w-4 fill-[#ffcc00] text-[#ffcc00] drop-shadow" /> : null}
      </button>
      <div className="flex items-start gap-1 px-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{nb.title}</div>
          <div className="truncate text-[12px] text-muted-foreground">{meta}</div>
        </div>
        {menuEl}
      </div>
    </div>
  );
}

function SelectionActions({
  ids,
  trash,
  allIds,
  onMove,
  onDone,
  onConfirm,
  onSelectAll,
}: {
  ids: UUID[];
  trash: boolean;
  allIds: UUID[];
  onMove: () => void;
  onDone: () => void;
  onConfirm: (c: { title: string; description?: string; label: string; run: () => void }) => void;
  onSelectAll: (ids: UUID[]) => void;
}) {
  const none = ids.length === 0;
  return (
    <>
      <Button variant="ghost" size="sm" className="text-primary" onClick={() => onSelectAll(ids.length === allIds.length ? [] : allIds)}>
        {ids.length === allIds.length ? 'Снять выбор' : 'Выбрать все'}
      </Button>
      {trash ? (
        <>
          <IconButton label="Восстановить" disabled={none} onClick={() => void guarded(() => restoreNotebooks(ids), 'Восстановлено').then(onDone)}>
            <RotateCcw className="h-5 w-5" />
          </IconButton>
          <IconButton
            label="Удалить навсегда"
            disabled={none}
            className="text-destructive"
            onClick={() => onConfirm({ title: `Удалить навсегда (${ids.length})?`, description: 'Это действие нельзя отменить.', label: 'Удалить', run: () => void guarded(() => deleteNotebooksPermanently(ids)).then(onDone) })}
          >
            <Trash2 className="h-5 w-5" />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton label="В избранное" disabled={none} onClick={() => void guarded(() => setFavorite(ids, true), 'Добавлено в избранное').then(onDone)}>
            <Star className="h-5 w-5" />
          </IconButton>
          <IconButton label="Переместить" disabled={none} onClick={onMove}>
            <FolderInput className="h-5 w-5" />
          </IconButton>
          <IconButton label="В корзину" disabled={none} className="text-destructive" onClick={() => void guarded(() => trashNotebooks(ids), 'Перемещено в корзину').then(onDone)}>
            <Trash2 className="h-5 w-5" />
          </IconButton>
        </>
      )}
    </>
  );
}

function EmptyState({ section, query, onCreate, onImport }: { section: Section; query: string; onCreate: () => void; onImport: () => void }) {
  if (query)
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center text-muted-foreground">
        <Search className="h-10 w-10" />
        Ничего не найдено по запросу «{query}»
      </div>
    );
  if (section.kind === 'trash')
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center text-muted-foreground">
        <Trash2 className="h-10 w-10" /> Корзина пуста
      </div>
    );
  if (section.kind === 'favorites' || section.kind === 'recent')
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center text-muted-foreground">
        {section.kind === 'favorites' ? <Star className="h-10 w-10" /> : <Clock className="h-10 w-10" />}
        {section.kind === 'favorites' ? 'Отметьте документы звёздочкой, чтобы они появились здесь' : 'Здесь появятся недавно открытые документы'}
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-accent text-primary">
        <BookOpen className="h-10 w-10" />
      </div>
      <div>
        <h2 className="text-[20px] font-semibold">Создайте первую тетрадь</h2>
        <p className="mt-1 max-w-sm text-[15px] text-muted-foreground">Пишите от руки, рисуйте и делайте пометки в PDF. Всё сохраняется на этом устройстве и работает без интернета.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onCreate} data-testid="empty-create">
          <FilePlus2 className="h-4 w-4" /> Новая тетрадь
        </Button>
        <Button variant="secondary" onClick={onImport}>
          <Upload className="h-4 w-4" /> Импорт PDF
        </Button>
      </div>
    </div>
  );
}

import { memo, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bookmark, BookmarkCheck, CopyPlus, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { pageThumbnail } from '@/export/pageRaster';
import { useSession } from '@/editor/session';
import { cn } from '@/lib/utils';
import type { Page } from '@/model/types';
import { useEditor } from '@/store/editor';
import { errorMessage, toast } from '@/store/ui';

const Thumb = memo(function Thumb({ page, version }: { page: Page; version: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const session = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    // Use in-memory elements when the page is open (includes edits not yet flushed).
    const els = session.model.getElements(page.id);
    pageThumbnail(page, version, 140, els ? [...els] : undefined).then(
      (u) => !cancelled && setUrl(u),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [visible, page, version, session]);

  return (
    <div ref={ref} className="w-full overflow-hidden rounded-[6px] bg-white shadow-soft ring-1 ring-black/5" style={{ aspectRatio: `${page.width} / ${page.height}`, background: page.paperColor }}>
      {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
    </div>
  );
});

export function PagesPanel() {
  const pages = useEditor((s) => s.pages);
  const versions = useEditor((s) => s.pageVersions);
  const current = useEditor((s) => s.view.pageIndex);
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'bookmarks'>('all');
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const p = pages[current];
    if (p) itemRefs.current.get(p.id)?.scrollIntoView({ block: 'nearest' });
  }, [current, pages]);

  const run = (fn: () => Promise<unknown>) => void fn().catch((err) => toast(errorMessage(err), { kind: 'error' }));
  const shown = filter === 'all' ? pages.map((p, i) => ({ p, i })) : pages.map((p, i) => ({ p, i })).filter(({ p }) => p.bookmarked);

  // Pointer-based drag reordering via the grip handle (HTML5 drag & drop does not work with touch on iOS).
  const onGripDown = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, over: pages.findIndex((p) => p.id === id) });
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag) return;
    let over = pages.length - 1;
    for (let i = 0; i < pages.length; i++) {
      const el = itemRefs.current.get(pages[i]!.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        over = i;
        break;
      }
    }
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onGripUp = () => {
    if (!drag) return;
    const from = pages.findIndex((p) => p.id === drag.id);
    const to = drag.over > from ? drag.over - 1 : drag.over;
    setDrag(null);
    if (to !== from && to >= 0) run(() => session.movePage(drag.id, to));
  };

  const addAtEnd = () =>
    run(async () => {
      const last = pages[pages.length - 1];
      const nb = session.notebook;
      const setup = last && !last.pdf ? { size: last.size === 'custom' ? nb.defaultSetup.size : last.size, orientation: last.width > last.height ? ('landscape' as const) : ('portrait' as const), template: last.template, paperColor: last.paperColor } : nb.defaultSetup;
      const idx = await session.addPageAfter(last?.id ?? null, setup);
      session.engine?.scrollToPage(idx);
    });

  return (
    <aside className="flex w-[168px] shrink-0 flex-col border-r bg-surface/70 backdrop-blur-xl" aria-label="Страницы">
      <div className="p-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'bookmarks', label: <Bookmark className="h-4 w-4" />, title: 'Закладки' },
          ]}
        />
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-3" onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={() => setDrag(null)}>
        {shown.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">Нет страниц с закладками</p>}
        {shown.map(({ p, i }) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) itemRefs.current.set(p.id, el);
              else itemRefs.current.delete(p.id);
            }}
            // Off-screen thumbnails are skipped by the browser's renderer (cheap virtualisation for long notebooks).
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.round(136 * (p.height / p.width)) + 48}px` }}
            className={cn('relative pt-3', drag?.over === i && drag.id !== p.id && 'before:absolute before:inset-x-0 before:top-0.5 before:h-1 before:rounded-full before:bg-primary')}
          >
            <button
              onClick={() => session.engine?.scrollToPage(i)}
              className={cn('block w-full rounded-[8px] p-1 transition-colors', i === current ? 'bg-primary/15 ring-2 ring-primary' : 'hover:bg-muted', drag?.id === p.id && 'opacity-40')}
              aria-label={`Страница ${i + 1}`}
              aria-current={i === current}
            >
              <Thumb page={p} version={versions[p.id] ?? 0} />
            </button>
            <div className="mt-1 flex items-center gap-0.5">
              <span onPointerDown={(e) => onGripDown(e, p.id)} className="grid h-8 w-6 cursor-grab touch-none place-items-center text-muted-foreground" aria-label="Перетащить страницу" role="button">
                <GripVertical className="h-4 w-4" />
              </span>
              <span className="flex-1 text-center text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
              {p.bookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Действия со страницей ${i + 1}`} size="icon-sm" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem onSelect={() => run(() => session.toggleBookmark(p))}>
                    <Bookmark /> {p.bookmarked ? 'Убрать закладку' : 'Добавить закладку'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      run(async () => {
                        const idx = await session.addPageAfter(p.id, { ...session.notebook.defaultSetup, template: p.pdf ? session.notebook.defaultSetup.template : p.template, paperColor: p.pdf ? '#ffffff' : p.paperColor });
                        session.engine?.scrollToPage(idx);
                      })
                    }
                  >
                    <Plus /> Новая страница после
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => run(() => session.duplicatePage(p.id))}>
                    <CopyPlus /> Дублировать
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === 0} onSelect={() => run(() => session.movePage(p.id, i - 1))}>
                    <ArrowUp /> Переместить выше
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === pages.length - 1} onSelect={() => run(() => session.movePage(p.id, i + 1))}>
                    <ArrowDown /> Переместить ниже
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive disabled={pages.length <= 1} onSelect={() => run(() => session.deletePage(p.id))}>
                    <Trash2 /> Удалить страницу
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
        <button onClick={addAtEnd} className="mt-3 flex w-full flex-col items-center gap-1 rounded-[8px] border-2 border-dashed py-6 text-[12px] text-muted-foreground hover:bg-muted" data-testid="add-page">
          <Plus className="h-5 w-5" /> Страница
        </button>
      </div>
    </aside>
  );
}

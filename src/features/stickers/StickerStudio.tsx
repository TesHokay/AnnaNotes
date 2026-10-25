import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/controls';
import { getDB } from '@/db/db';
import { deleteStickerAsset } from '@/db/repo';
import { useSession } from '@/editor/session';
import { pickFiles } from '@/lib/files';
import { useLive } from '@/lib/useLive';
import { cn } from '@/lib/utils';
import type { StickerAsset } from '@/model/types';
import { errorMessage, toast } from '@/store/ui';
import { BUILTIN_BY_ID, BUILTIN_STICKERS, builtinUrl, matchesSticker, STICKER_CATEGORIES, type BuiltinSticker, type StickerCategory } from './library';
import { builtinKey, customKey, importStickerFile, insertSticker, useStickerPrefs } from './stickers';

type Tab = 'all' | 'favorites' | 'recent' | 'mine' | StickerCategory;

interface Item {
  key: string;
  name: string;
  url: string;
  custom?: StickerAsset;
}

/** Object URLs for the user's stickers; revoked when the panel closes (frees decoded images). */
function useCustomUrls(list: StickerAsset[] | undefined): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  useEffect(() => {
    const m = new Map<string, string>();
    for (const s of list ?? []) m.set(s.id, URL.createObjectURL(s.blob));
    setUrls(m);
    return () => {
      for (const u of m.values()) URL.revokeObjectURL(u);
    };
  }, [list]);
  return urls;
}

/**
 * Sticker library: categories, search, favourites, recents and the user's own stickers. A tap
 * inserts the sticker in the middle of the visible page, already selected for editing.
 */
export function StickerStudio({ onInserted }: { onInserted?: () => void }) {
  const session = useSession();
  const prefs = useStickerPrefs();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const custom = useLive(() => getDB().stickers.orderBy('createdAt').reverse().toArray(), []);
  const urls = useCustomUrls(custom);

  useEffect(() => {
    void prefs.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<Item[]>(() => {
    const builtin = (list: readonly BuiltinSticker[]) => list.map((s) => ({ key: builtinKey(s.id), name: s.name, url: builtinUrl(s), search: `${s.keywords} ${s.category}` }));
    const mine = (custom ?? []).map((s) => ({ key: customKey(s.id), name: s.name, url: urls.get(s.id) ?? '', custom: s, search: 'мои my custom' }));
    const byKey = (key: string) => {
      if (key.startsWith('builtin:')) {
        const s = BUILTIN_BY_ID.get(key.slice(8));
        return s ? builtin([s])[0] : undefined;
      }
      return mine.find((m) => m.key === key);
    };
    let list: (Item & { search?: string })[];
    if (tab === 'favorites') list = prefs.favorites.map(byKey).filter((x): x is NonNullable<typeof x> => !!x);
    else if (tab === 'recent') list = prefs.recents.map(byKey).filter((x): x is NonNullable<typeof x> => !!x);
    else if (tab === 'mine') list = mine;
    else if (tab === 'all') list = [...mine, ...builtin(BUILTIN_STICKERS)];
    else list = builtin(BUILTIN_STICKERS.filter((s) => s.category === tab));
    return list.filter((i) => matchesSticker({ name: i.name, keywords: i.search }, query));
  }, [tab, query, custom, urls, prefs.favorites, prefs.recents]);

  const insert = async (item: Item) => {
    try {
      await insertSticker(session, item.key, item.custom);
      onInserted?.();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  const importFiles = async () => {
    const files = await pickFiles('image/png,image/webp,image/svg+xml,.png,.webp,.svg', true);
    let ok = 0;
    for (const f of files) {
      try {
        await importStickerFile(f);
        ok++;
      } catch (err) {
        toast(`«${f.name}»: ${errorMessage(err)}`, { kind: 'error' });
      }
    }
    if (ok) {
      setTab('mine');
      toast(ok === 1 ? 'Стикер добавлен' : `Добавлено стикеров: ${ok}`, { kind: 'success' });
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'favorites', label: 'Избранное' },
    { id: 'recent', label: 'Недавние' },
    { id: 'mine', label: 'Мои' },
    ...STICKER_CATEGORIES,
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="sticker-studio">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск стикеров" aria-label="Поиск стикеров" className="h-10 pl-9 pr-9" />
        {query && (
          <button className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => setQuery('')} aria-label="Очистить поиск">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Категории стикеров">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('min-h-8 rounded-full border px-2.5 py-1 text-[12px] leading-tight transition-colors', tab === t.id ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
        {tab === 'mine' && (
          <button onClick={() => void importFiles()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[11px] leading-tight text-muted-foreground hover:bg-muted" data-testid="sticker-import">
            <Plus className="h-5 w-5" />
            PNG, WebP, SVG
          </button>
        )}
        {items.map((item) => {
          const fav = prefs.favorites.includes(item.key);
          return (
            <div key={item.key} className="group relative">
              <button onClick={() => void insert(item)} title={item.name} aria-label={`Вставить: ${item.name}`} className="grid aspect-square w-full place-items-center rounded-md p-1.5 transition-colors hover:bg-muted active:scale-95" data-testid="sticker-item">
                {item.url && <img src={item.url} alt="" loading="lazy" decoding="async" draggable={false} className="max-h-full max-w-full object-contain" />}
              </button>
              <button
                onClick={() => prefs.toggleFavorite(item.key)}
                aria-label={fav ? `Убрать из избранного: ${item.name}` : `В избранное: ${item.name}`}
                aria-pressed={fav}
                className={cn('absolute right-0 top-0 grid h-7 w-7 place-items-center rounded-full', fav ? 'text-[#e0a400]' : 'text-muted-foreground/60 hover:text-foreground')}
              >
                <Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />
              </button>
              {item.custom && (
                <button
                  onClick={() => {
                    void deleteStickerAsset(item.custom!.id).then(() => prefs.forget(item.key));
                  }}
                  aria-label={`Удалить из библиотеки: ${item.name}`}
                  className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full text-muted-foreground/70 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!items.length && tab !== 'mine' && (
        <p className="py-4 text-center text-[13px] text-muted-foreground">
          {tab === 'favorites' ? 'Нажмите ☆ на стикере, чтобы добавить его в избранное.' : tab === 'recent' ? 'Здесь появятся стикеры, которые вы недавно вставляли.' : 'Ничего не найдено'}
        </p>
      )}
      {tab === 'mine' && !custom?.length && <p className="text-[12px] text-muted-foreground">Добавьте свои картинки с прозрачным фоном. Стикеры из библиотеки, уже вставленные на страницы, при удалении не пропадают.</p>}
    </div>
  );
}

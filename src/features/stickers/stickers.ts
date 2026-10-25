import { create } from 'zustand';
import { addStickerAsset, getAsset, getSetting, putAsset, setSetting } from '@/db/repo';
import type { EditorSession } from '@/editor/session';
import { downscaleImage } from '@/lib/images';
import type { StickerAsset } from '@/model/types';
import { useSettings } from '@/store/settings';
import { BUILTIN_BY_ID, builtinBlob } from './library';
import { sanitizeSvg } from './sanitize';

const PREFS_KEY = 'stickerPrefs';
const MAX_RECENT = 16;
/** Display size of a freshly inserted sticker (points). */
export const STICKER_SIZE = 96;
const MAX_SVG_BYTES = 2 * 1024 * 1024;

interface Prefs {
  favorites: string[];
  recents: string[];
}

interface StickerPrefsState extends Prefs {
  loaded: boolean;
  load(): Promise<void>;
  toggleFavorite(key: string): void;
  pushRecent(key: string): void;
  forget(key: string): void;
}

/** Favourites and recents of the Sticker Studio, persisted in the settings table. */
export const useStickerPrefs = create<StickerPrefsState>((set, get) => {
  const persist = () => {
    const { favorites, recents } = get();
    void setSetting(PREFS_KEY, { favorites, recents }).catch(() => {});
  };
  return {
    favorites: [],
    recents: [],
    loaded: false,
    async load() {
      if (get().loaded) return;
      const p = await getSetting<Prefs>(PREFS_KEY, { favorites: [], recents: [] });
      set({ favorites: Array.isArray(p.favorites) ? p.favorites : [], recents: Array.isArray(p.recents) ? p.recents : [], loaded: true });
    },
    toggleFavorite(key) {
      const f = get().favorites;
      set({ favorites: f.includes(key) ? f.filter((k) => k !== key) : [key, ...f] });
      persist();
    },
    pushRecent(key) {
      set({ recents: [key, ...get().recents.filter((k) => k !== key)].slice(0, MAX_RECENT) });
      persist();
    },
    forget(key) {
      set({ favorites: get().favorites.filter((k) => k !== key), recents: get().recents.filter((k) => k !== key) });
      persist();
    },
  };
});

export const builtinKey = (id: string) => `builtin:${id}`;
export const customKey = (id: string) => `custom:${id}`;

/**
 * Page assets already created for a sticker in this session: inserting the same sticker again
 * reuses the stored blob and its decoded image instead of duplicating it.
 */
const assetFor = new Map<string, { assetId: string; width: number; height: number }>();

/** Inserts a library sticker into the current page as an editable, auto-selected element. */
export async function insertSticker(session: EditorSession, key: string, custom?: StickerAsset): Promise<void> {
  let entry = assetFor.get(key);
  if (entry && !(await getAsset(entry.assetId))) entry = undefined;
  if (!entry) {
    if (key.startsWith('builtin:')) {
      const s = BUILTIN_BY_ID.get(key.slice(8));
      if (!s) throw new Error('Стикер не найден');
      const m = /viewBox="0 0 (\d+) (\d+)"/.exec(s.svg);
      const width = m ? Number(m[1]) * 2 : 240;
      const height = m ? Number(m[2]) * 2 : 240;
      const asset = await putAsset(builtinBlob(s), 'image', `${s.name}.svg`, { width, height });
      entry = { assetId: asset.id, width, height };
    } else {
      if (!custom) throw new Error('Стикер не найден');
      const asset = await putAsset(custom.blob, 'image', custom.name, { width: custom.width, height: custom.height });
      entry = { assetId: asset.id, width: custom.width, height: custom.height };
    }
    assetFor.set(key, entry);
  }
  // The selection frame is the lasso tool's: switch to it so the sticker can be moved at once.
  useSettings.getState().updateTools((t) => ({ ...t, tool: 'lasso' }));
  session.engine?.insertImage(entry.assetId, entry.width, entry.height, { maxSide: STICKER_SIZE, extra: { sticker: key } });
  useStickerPrefs.getState().pushRecent(key);
}

/** Imports PNG / WebP / SVG files into the user's sticker library (Blob in IndexedDB). */
export async function importStickerFile(file: File): Promise<StickerAsset> {
  const name = file.name.replace(/\.(png|webp|svg)$/i, '') || 'Стикер';
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    if (file.size > MAX_SVG_BYTES) throw new Error('SVG слишком большой (максимум 2 МБ)');
    const clean = sanitizeSvg(await file.text());
    return addStickerAsset({ name, mime: 'image/svg+xml', blob: new Blob([clean.svg], { type: 'image/svg+xml' }), width: clean.width, height: clean.height });
  }
  if (!/^image\/(png|webp)$/.test(file.type) && !/\.(png|webp)$/i.test(file.name)) throw new Error('Поддерживаются PNG, WebP и SVG');
  // Stored as PNG (keeps transparency, exports to PDF), at most 1024 px.
  const img = await downscaleImage(file, 1024, 'image/png');
  return addStickerAsset({ name, mime: 'image/png', blob: img.blob, width: img.width, height: img.height });
}

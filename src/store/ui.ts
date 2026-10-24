import { create } from 'zustand';
import { saveQueue, type SaveState } from '@/db/saveQueue';
import { uuid } from '@/lib/id';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
  duration: number;
}

export type Route = { name: 'library' } | { name: 'notebook'; id: string };

interface UIState {
  route: Route;
  toasts: Toast[];
  save: SaveState;
  online: boolean;
  updateAvailable: boolean;
  applyUpdate: (() => Promise<void>) | null;
  storagePersisted: boolean | null;
  dbError: string | null;
  toast(message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>): void;
  dismiss(id: string): void;
  setUpdate(apply: (() => Promise<void>) | null): void;
}

export function parseHash(hash: string): Route {
  const m = /^#\/nb\/([\w-]+)/.exec(hash);
  return m && m[1] ? { name: 'notebook', id: m[1] } : { name: 'library' };
}

export const useUI = create<UIState>((set) => ({
  route: typeof location !== 'undefined' ? parseHash(location.hash) : { name: 'library' },
  toasts: [],
  save: saveQueue.getState(),
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  updateAvailable: false,
  applyUpdate: null,
  storagePersisted: null,
  dbError: null,
  toast(message, opts = {}) {
    const t: Toast = { id: uuid(), kind: opts.kind ?? 'info', message, action: opts.action, duration: opts.duration ?? (opts.kind === 'error' ? 6000 : 3000) };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  setUpdate(apply) {
    set({ updateAvailable: apply !== null, applyUpdate: apply });
  },
}));

export function navigate(route: Route): void {
  const hash = route.name === 'library' ? '#/' : `#/nb/${route.id}`;
  if (location.hash !== hash) location.hash = hash;
  useUI.setState({ route });
}

export function initUIListeners(): () => void {
  const onHash = () => useUI.setState({ route: parseHash(location.hash) });
  const onOnline = () => useUI.setState({ online: navigator.onLine });
  window.addEventListener('hashchange', onHash);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOnline);
  const unsub = saveQueue.subscribe((save) => useUI.setState({ save }));
  return () => {
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOnline);
    unsub();
  };
}

/** Convenience for non-React modules. */
export const toast = (message: string, opts?: Partial<Omit<Toast, 'id' | 'message'>>) => useUI.getState().toast(message, opts);

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

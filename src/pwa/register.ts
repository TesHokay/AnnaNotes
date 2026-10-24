import { registerSW } from 'virtual:pwa-register';
import { saveQueue } from '@/db/saveQueue';
import { toast, useUI } from '@/store/ui';
import { isEditorBusy } from '@/editor/busy';

/**
 * The service worker precaches the app shell (HTML/JS/CSS/icons/pdf.js worker). User documents
 * never go through it — they live in IndexedDB — so updating the app cannot touch them.
 *
 * Updates are never applied automatically: a new worker waits until the user taps "Update",
 * and even then we first wait for the current stroke to finish and for pending saves to flush.
 */

export interface SwDiagnostics {
  supported: boolean;
  registered: boolean;
  scope: string | null;
  state: string | null;
  controlled: boolean;
  offlineReady: boolean;
  waiting: boolean;
  lastError: string | null;
  lastUpdateCheck: number | null;
}

export const swDiag: SwDiagnostics = {
  supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  registered: false,
  scope: null,
  state: null,
  controlled: typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller,
  offlineReady: false,
  waiting: false,
  lastError: null,
  lastUpdateCheck: null,
};

let registration: ServiceWorkerRegistration | undefined;

/** Asks the server for a newer sw.js (no-op offline). */
export async function checkForUpdate(): Promise<void> {
  if (!registration || !navigator.onLine) return;
  try {
    swDiag.lastUpdateCheck = Date.now();
    await registration.update();
  } catch (err) {
    swDiag.lastError = `update: ${(err as Error).message}`;
  }
}

export function registerServiceWorker(): void {
  if (!swDiag.supported || import.meta.env.DEV) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      swDiag.waiting = true;
      useUI.getState().setUpdate(async () => {
        const started = Date.now();
        while (isEditorBusy() && Date.now() - started < 10_000) await new Promise((r) => setTimeout(r, 200));
        try {
          await saveQueue.flush();
        } catch {
          toast('Не удалось сохранить изменения — обновление отложено', { kind: 'error' });
          return;
        }
        await updateSW(true);
      });
    },
    onOfflineReady() {
      swDiag.offlineReady = true;
      useUI.setState({ offlineReady: true });
      toast('Приложение сохранено на устройстве и будет работать без интернета', { kind: 'success', duration: 5000 });
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      swDiag.registered = !!reg;
      swDiag.scope = reg?.scope ?? null;
      swDiag.state = reg?.active?.state ?? reg?.installing?.state ?? null;
      // An already-active worker means the shell is cached (e.g. second launch of the installed app).
      if (reg?.active) {
        swDiag.offlineReady = true;
        useUI.setState({ offlineReady: true });
      }
      if (!reg) return;
      // Look for a new deployment when the app comes back to the foreground, regains network,
      // and hourly while open. iPadOS suspends PWAs instead of closing them, so the foreground
      // check is what actually catches most updates.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkForUpdate();
      });
      window.addEventListener('online', () => void checkForUpdate());
      setInterval(() => void checkForUpdate(), 60 * 60 * 1000);
    },
    onRegisterError(err) {
      swDiag.lastError = `register: ${(err as Error)?.message ?? String(err)}`;
      console.warn('Service worker registration failed', err);
    },
  });
}

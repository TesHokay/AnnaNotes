import { registerSW } from 'virtual:pwa-register';
import { saveQueue } from '@/db/saveQueue';
import { toast, useUI } from '@/store/ui';
import { isEditorBusy } from '@/editor/busy';

/**
 * The service worker precaches the app shell (HTML/JS/CSS/fonts/icons/pdf.js worker). User
 * documents never go through it — they live in IndexedDB — so updating the app cannot touch them.
 *
 * Updates are never applied automatically: a new worker waits until the user taps "Update",
 * and even then we first wait for the current stroke to finish and for pending saves to flush.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
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
      toast('Приложение сохранено на устройстве и будет работать без интернета', { kind: 'success', duration: 5000 });
    },
    onRegisteredSW(_url, reg) {
      // Check for updates hourly while the app stays open.
      if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
    onRegisterError(err) {
      console.warn('Service worker registration failed', err);
    },
  });
}

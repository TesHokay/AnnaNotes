import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { saveQueue } from './db/saveQueue';
import { flushSettings } from './store/settings';
import { registerServiceWorker } from './pwa/register';
import './index.css';

/*
 * Durability: finished strokes are queued and written within ~350 ms. When the page is hidden
 * (app switch, tab close, iOS suspending the PWA) we flush immediately. visibilitychange/pagehide
 * are the events iOS reliably delivers; beforeunload only adds a warning when something is
 * still unsaved.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushSettings();
    void saveQueue.flush().catch(() => {});
  }
});
window.addEventListener('pagehide', () => {
  flushSettings();
  void saveQueue.flush().catch(() => {});
});
window.addEventListener('beforeunload', (e) => {
  if (saveQueue.hasPending) {
    void saveQueue.flush().catch(() => {});
    e.preventDefault();
  }
});

// Block browser pinch-zoom of the whole UI on iOS (the canvas has its own zoom).
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

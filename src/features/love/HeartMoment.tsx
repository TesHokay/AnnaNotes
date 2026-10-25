import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/db/repo';
import { isEditorBusy } from '@/editor/busy';
import { useImport } from '@/features/import/importQueue';
import { isBackgroundTaskRunning } from '@/lib/activity';
import { useEditor } from '@/store/editor';
import { HeartMomentScheduler, normalizeState } from './scheduler';

const KEY = 'heartMoment';
const TICK_MS = 5000;
const SAVE_EVERY_MS = 60_000;
const SHOW_MS = 7600;

/** Anything on screen the surprise must not compete with. */
function uiBusy(pointersDown: number): boolean {
  if (pointersDown > 0 || isEditorBusy() || isBackgroundTaskRunning() || useImport.getState().running) return true;
  const ed = useEditor.getState();
  if (ed.selection || ed.textEdit) return true;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-testid="splash"]');
}

/**
 * Mounted once for the whole app. Costs one 5-second timer while the app is visible and a few
 * passive listeners that only store a timestamp — nothing touches the drawing engine.
 */
export function HeartMoment() {
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let scheduler: HeartMomentScheduler | null = null;
    let disposed = false;
    let lastInteraction = Date.now();
    let pointersDown = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastSave = Date.now();

    const show = (text: string) => {
      setShown({ id: Date.now(), text });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShown(null), SHOW_MS);
    };
    const save = () => {
      if (scheduler) void setSetting(KEY, scheduler.state).catch(() => {});
      lastSave = Date.now();
    };
    const tick = () => {
      if (!scheduler) return;
      const now = Date.now();
      const due = scheduler.tick({ now, visible: document.visibilityState === 'visible', lastInteraction, busy: uiBusy(pointersDown) });
      if (due) {
        const text = scheduler.consume();
        save();
        show(text);
      } else if (now - lastSave > SAVE_EVERY_MS) save();
    };
    const start = () => {
      if (!timer) timer = setInterval(tick, TICK_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onInput = () => {
      lastInteraction = Date.now();
    };
    const onDown = () => {
      pointersDown++;
      lastInteraction = Date.now();
    };
    const onUp = () => {
      pointersDown = Math.max(0, pointersDown - 1);
      lastInteraction = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Background: stop counting and drop any animation in progress.
        tick();
        stop();
        save();
        pointersDown = 0;
        setShown(null);
      } else {
        lastInteraction = Date.now();
        scheduler?.tick({ now: Date.now(), visible: true, lastInteraction, busy: true }); // restart the clock without crediting the gap
        start();
      }
    };

    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);
    window.addEventListener('keydown', onInput, opts);
    window.addEventListener('wheel', onInput, opts);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);

    void getSetting<unknown>(KEY, null).then((raw) => {
      if (disposed) return;
      scheduler = new HeartMomentScheduler(normalizeState(raw));
      scheduler.tick({ now: Date.now(), visible: true, lastInteraction, busy: true });
      if (document.visibilityState === 'visible') start();
      // Manual check in development builds: __heartMoment() shows one immediately.
      if (import.meta.env.DEV) (window as unknown as { __heartMoment?: () => void }).__heartMoment = () => show(scheduler!.consume());
    });

    return () => {
      disposed = true;
      stop();
      save();
      window.removeEventListener('pointerdown', onDown, opts);
      window.removeEventListener('pointerup', onUp, opts);
      window.removeEventListener('pointercancel', onUp, opts);
      window.removeEventListener('keydown', onInput, opts);
      window.removeEventListener('wheel', onInput, opts);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!shown) return null;
  return (
    <div
      key={shown.id}
      className="heart-moment pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] left-[calc(env(safe-area-inset-left)+14px)] z-[60] flex max-w-[min(20rem,calc(100vw-28px))] items-center gap-2.5 sm:bottom-[calc(env(safe-area-inset-bottom)+16px)]"
      role="status"
      aria-live="polite"
      data-testid="heart-moment"
    >
      <svg viewBox="0 0 48 48" className="heart-moment__heart h-11 w-11 shrink-0" aria-hidden>
        <path
          className="heart-moment__path"
          pathLength={1}
          d="M24 40C14 33 5 26 5 17C5 10.5 10 6 15.5 6C19.5 6 22.5 8.5 24 11.5C25.5 8.5 28.5 6 32.5 6C38 6 43 10.5 43 17C43 26 34 33 24 40Z"
          fill="none"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path className="heart-moment__fill" d="M24 40C14 33 5 26 5 17C5 10.5 10 6 15.5 6C19.5 6 22.5 8.5 24 11.5C25.5 8.5 28.5 6 32.5 6C38 6 43 10.5 43 17C43 26 34 33 24 40Z" />
      </svg>
      <span className="heart-moment__text min-w-0 rounded-full border px-3.5 py-1.5 text-[14px] font-medium leading-snug shadow-soft [overflow-wrap:anywhere]">{shown.text}</span>
    </div>
  );
}

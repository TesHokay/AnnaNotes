import { useEffect, useRef } from 'react';
import type { Composition } from './compose';
import { InkPlayer, inkColors, type InkFit } from './ink';

/**
 * Canvas pair that writes a composition with the calligraphy pen. Used by the launch animation
 * and the secret message. Stops in the background (rAF does not run) and resumes where it was;
 * a resize re-lays out and redraws the current state.
 */
export function InkCanvas({
  comp,
  fit,
  animate = true,
  onComplete,
  label,
  className,
}: {
  comp: Composition;
  fit: (width: number, height: number) => InkFit;
  animate?: boolean;
  onComplete?: () => void;
  label: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const box = boxRef.current;
    const base = baseRef.current;
    const live = liveRef.current;
    if (!box || !base || !live || !base.getContext('2d')) {
      onCompleteRef.current?.();
      return;
    }
    const player = new InkPlayer(base, live, comp, inkColors());
    let raf = 0;
    let t0 = performance.now();
    let pausedAt: number | null = null;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onCompleteRef.current?.();
    };
    const now = () => (animate ? performance.now() - t0 : Number.POSITIVE_INFINITY);
    const layout = () => {
      const r = box.getBoundingClientRect();
      const w = r.width || window.innerWidth;
      const h = r.height || window.innerHeight;
      player.layout(w, h, Math.min(window.devicePixelRatio || 1, 3), fit(w, h));
      player.frame(now());
    };
    const tick = () => {
      if (player.frame(now())) {
        done();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    layout();
    if (animate) raf = requestAnimationFrame(tick);
    else done();
    // Pause the clock while hidden, so the writing continues instead of jumping to the end.
    const onVisibility = () => {
      if (!animate || finished) return;
      if (document.visibilityState === 'hidden') {
        pausedAt = performance.now();
        cancelAnimationFrame(raf);
      } else if (pausedAt !== null) {
        t0 += performance.now() - pausedAt;
        pausedAt = null;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
    ro?.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The composition and fit are fixed for the lifetime of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, animate]);

  return (
    <div ref={boxRef} className={className} role="img" aria-label={label}>
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={liveRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

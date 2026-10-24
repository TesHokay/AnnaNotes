import { useEffect, useRef, useState } from 'react';
import { composePhrase, type Composition } from './compose';
import { PHRASES } from './glyphs';
import { claimSplashForSession, isSplashEnabled, nextLanguage, type SplashLang } from './shuffleBag';

/**
 * Decided once per page load (module evaluation), so React re-renders or StrictMode double
 * invocation can never replay the animation or change the language.
 */
function decide(): SplashLang | null {
  if (typeof window === 'undefined') return null;
  if (!isSplashEnabled()) return null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  if (!claimSplashForSession(sessionStorage)) return null;
  try {
    return nextLanguage(localStorage);
  } catch {
    return 'en';
  }
}

export const SPLASH_LANG: SplashLang | null = decide();

const FADE_MS = 420;
const HOLD_MS = 380;

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

/**
 * Launch animation: an invisible calligraphy pen writes "I love you" in one of seven languages
 * along hand-authored centre lines (variable-width pointed-pen / brush strokes), then draws a
 * heart, then fades into the library. The app loads underneath in parallel.
 */
export function SplashScreen({ lang, onDone }: { lang: SplashLang; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFading(true);
    setTimeout(onDone, FADE_MS);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      onDone();
      return;
    }
    let comp: Composition;
    try {
      comp = composePhrase(lang);
    } catch {
      onDone();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const bw = comp.bbox.maxX - comp.bbox.minX;
    const bh = comp.bbox.maxY - comp.bbox.minY;
    // Fit inside the safe part of the screen on any device; long phrases get smaller, not clipped.
    const k = Math.min((w * 0.84) / bw, (h * 0.3) / bh, lang === 'zh' ? 2.4 : 2.0);
    const ox = (w - bw * k) / 2 - comp.bbox.minX * k;
    const oy = h * 0.46 - (bh * k) / 2 - comp.bbox.minY * k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ink = cssColor('--foreground', '#2a2226');
    const heart = document.documentElement.classList.contains('dark') ? '#e0607a' : '#a3203a';
    const drawn = comp.strokes.map(() => 0);
    const t0 = performance.now();
    let raf = 0;

    const tick = () => {
      const elapsed = performance.now() - t0;
      comp.strokes.forEach((s, si) => {
        if (elapsed < s.start) return;
        const progress = Math.min(1, (elapsed - s.start) / s.duration);
        let idx = drawn[si]!;
        const last = s.pts.length - 1;
        let target = idx;
        while (target < last && s.times[target + 1]! <= progress) target++;
        if (target <= idx && idx > 0) return;
        ctx.strokeStyle = s.color === 'heart' ? heart : ink;
        // Ink only accumulates: draw just the newly written segments (round caps, opaque ink).
        for (let i = Math.max(1, idx); i <= target; i++) {
          const a = s.pts[i - 1]!;
          const b = s.pts[i]!;
          ctx.beginPath();
          ctx.lineWidth = (s.widths[i - 1]! + s.widths[i]!) / 2;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        idx = Math.max(idx, target);
        drawn[si] = idx;
      });
      if (elapsed >= comp.end + HOLD_MS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return (
    <div
      className={`fixed inset-0 z-[200] bg-background transition-opacity ease-out ${fading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onPointerDown={finish}
      data-testid="splash"
      data-lang={lang}
    >
      <canvas ref={canvasRef} role="img" aria-label={PHRASES[lang]} className="absolute inset-0 h-full w-full" />
      <button
        type="button"
        onClick={finish}
        aria-label="Пропустить анимацию"
        className="pb-safe absolute bottom-0 right-0 m-4 rounded-full bg-muted/70 px-4 py-2 text-[13px] text-muted-foreground backdrop-blur"
      >
        Пропустить
      </button>
    </div>
  );
}

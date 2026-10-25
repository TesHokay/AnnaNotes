import { useEffect, useMemo, useRef, useState } from 'react';
import { composePhrase, type Composition } from './compose';
import { PHRASES } from './glyphs';
import { InkCanvas } from './InkCanvas';
import { claimSplashForSession, isSplashEnabled, nextLanguage, type SplashLang } from './shuffleBag';

export interface SplashPlan {
  lang: SplashLang;
  /** prefers-reduced-motion: the finished phrase is shown briefly instead of being written. */
  reduced: boolean;
}

/**
 * Decided once per page load (module evaluation), so React re-renders or StrictMode double
 * invocation can never replay the animation or change the language.
 */
function decide(): SplashPlan | null {
  if (typeof window === 'undefined') return null;
  if (!isSplashEnabled()) return null;
  if (!claimSplashForSession(sessionStorage)) return null;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  try {
    return { lang: nextLanguage(localStorage), reduced };
  } catch {
    return { lang: 'en', reduced };
  }
}

export const SPLASH: SplashPlan | null = decide();

const FADE_MS = 650;
/** The finished composition stays on screen for a moment before the library appears. */
const HOLD_MS = 1100;
const REDUCED_HOLD_MS = 1400;

/**
 * Launch animation: an invisible calligraphy pen writes "I love you" in one of seven languages
 * along hand-authored centre lines, then draws a heart, holds, and fades into the library. The
 * app loads underneath in parallel. It always ends by itself; any failure ends it immediately.
 */
export function SplashScreen({ plan, onDone }: { plan: SplashPlan; onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);
  const comp = useMemo<Composition | null>(() => {
    try {
      return composePhrase(plan.lang);
    } catch {
      return null;
    }
  }, [plan.lang]);

  const finish = (delay: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setTimeout(() => {
      setFading(true);
      setTimeout(onDone, FADE_MS);
    }, delay);
  };

  useEffect(() => {
    if (!comp) {
      onDone();
      return;
    }
    // Safety net: even if frames never run (throttled WebView), the app is never blocked.
    const guard = setTimeout(() => finish(0), comp.end + HOLD_MS + 4000);
    return () => clearTimeout(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);

  if (!comp) return null;
  const zh = plan.lang === 'zh';
  return (
    <div
      className={`pt-safe pb-safe pl-safe pr-safe fixed inset-0 z-[200] bg-background transition-opacity ease-out ${fading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      data-testid="splash"
      data-lang={plan.lang}
    >
      <InkCanvas
        comp={comp}
        animate={!plan.reduced}
        label={PHRASES[plan.lang]}
        className="absolute inset-0"
        fit={(w, h) => ({ maxWidth: w * 0.84, maxHeight: h * 0.34, maxScale: zh ? 2.2 : 1.9, cx: w / 2, cy: h / 2 })}
        onComplete={() => finish(plan.reduced ? REDUCED_HOLD_MS : HOLD_MS)}
      />
    </div>
  );
}

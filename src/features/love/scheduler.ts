/**
 * Heart Moment: a tiny drawn heart with a sweet phrase that appears now and then during real
 * study time. There are deliberately no settings — it just happens, rarely.
 *
 * Only active time counts: the app is visible and was touched within the last few minutes.
 * The first surprise comes after 35–60 active minutes, the next ones 45–90 minutes after the
 * previous; when one is due it waits for a calm moment (no writing, gestures, selection,
 * dialogs, import/export) and never shows right after launch.
 */

export const MESSAGES = [
  'Ты умничка ♡',
  'Я тобой горжусь',
  'Не забывай отдыхать',
  'У тебя всё получится',
  'Ты моё солнышко',
  'Посылаю тебе обнимашки',
  'Ты самая лучшая ♡',
  'Я в тебя верю',
  'Обнимаю тебя',
  'Ты у меня молодец',
  'Ещё чуть-чуть, и всё получится',
  'Люблю тебя ♡',
] as const;

const MIN = 60_000;
export const FIRST_RANGE = [35 * MIN, 60 * MIN] as const;
export const NEXT_RANGE = [45 * MIN, 90 * MIN] as const;
/** Without touching the app for this long, time stops counting (reading a book, gone away). */
export const IDLE_MS = 3 * MIN;
/** Never in the first minutes of a session, even if the moment was already due. */
export const SESSION_WARMUP_MS = 4 * MIN;
/** Calm: no input for a moment … */
export const CALM_AFTER_MS = 2500;
/** … but the person is still here. */
export const PRESENT_WITHIN_MS = 90_000;

/** HeartMomentState: the only thing persisted (settings table, key `heartMoment`). */
export interface HeartMomentState {
  /** Total active study time counted so far (ms). */
  activeMs: number;
  /** Active time at which the next surprise becomes due. */
  dueAtMs: number;
  /** Remaining message indexes of the current shuffle cycle. */
  bag: number[];
  /** Last shown message (a new cycle never starts with it). */
  last: number | null;
  shownCount: number;
}

export interface Environment {
  now: number;
  visible: boolean;
  lastInteraction: number;
  /** Writing, erasing, pinching, lasso/transform, open dialog or menu, import/export, selection. */
  busy: boolean;
}

const between = ([a, b]: readonly [number, number], random: () => number) => a + (b - a) * random();

export function initialState(random: () => number = Math.random): HeartMomentState {
  return { activeMs: 0, dueAtMs: between(FIRST_RANGE, random), bag: [], last: null, shownCount: 0 };
}

export function normalizeState(raw: unknown, random: () => number = Math.random): HeartMomentState {
  const s = raw as Partial<HeartMomentState> | null;
  if (!s || typeof s.activeMs !== 'number' || typeof s.dueAtMs !== 'number' || !Number.isFinite(s.activeMs) || !Number.isFinite(s.dueAtMs)) return initialState(random);
  return {
    activeMs: Math.max(0, s.activeMs),
    dueAtMs: s.dueAtMs,
    bag: Array.isArray(s.bag) ? s.bag.filter((i) => Number.isInteger(i) && i >= 0 && i < MESSAGES.length) : [],
    last: typeof s.last === 'number' ? s.last : null,
    shownCount: typeof s.shownCount === 'number' ? s.shownCount : 0,
  };
}

export class HeartMomentScheduler {
  private sessionActiveMs = 0;
  private lastTick: number | null = null;

  constructor(
    public state: HeartMomentState,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * Advances the clock. Returns true when a surprise should be shown right now. Call it every
   * few seconds; gaps (background, sleep) are never counted.
   */
  tick(env: Environment): boolean {
    const prev = this.lastTick;
    this.lastTick = env.now;
    const active = env.visible && env.now - env.lastInteraction <= IDLE_MS;
    if (prev !== null && active) {
      // Cap a single step: a frozen timer must not credit hours at once.
      const dt = Math.min(Math.max(0, env.now - prev), 30_000);
      this.state.activeMs += dt;
      this.sessionActiveMs += dt;
    }
    if (!active || env.busy) return false;
    if (this.state.activeMs < this.state.dueAtMs || this.sessionActiveMs < SESSION_WARMUP_MS) return false;
    const quiet = env.now - env.lastInteraction;
    return quiet >= CALM_AFTER_MS && quiet <= PRESENT_WITHIN_MS;
  }

  /** Picks the message (shuffle bag: no repeats within a cycle) and schedules the next one. */
  consume(): string {
    const s = this.state;
    if (!s.bag.length) {
      const order = MESSAGES.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      if (order[0] === s.last) order.push(order.shift()!);
      s.bag = order;
    }
    const idx = s.bag.shift()!;
    s.last = idx;
    s.shownCount++;
    s.dueAtMs = s.activeMs + between(NEXT_RANGE, this.random);
    return MESSAGES[idx]!;
  }
}

import { CALM_AFTER_MS, FIRST_RANGE, HeartMomentScheduler, IDLE_MS, initialState, MESSAGES, NEXT_RANGE, normalizeState, SESSION_WARMUP_MS, type Environment } from './scheduler';

const MIN = 60_000;

/** Simulates studying: a touch every `touchEvery` ms, ticks every 5 s. Returns when it fired. */
function study(s: HeartMomentScheduler, clock: { now: number; last: number }, ms: number, opts: { touchEvery?: number; busy?: boolean; visible?: boolean } = {}): number | null {
  const end = clock.now + ms;
  while (clock.now < end) {
    clock.now += 5000;
    if (opts.touchEvery && clock.now % opts.touchEvery < 5000) clock.last = clock.now - CALM_AFTER_MS - 500;
    const env: Environment = { now: clock.now, visible: opts.visible ?? true, lastInteraction: clock.last, busy: opts.busy ?? false };
    if (s.tick(env)) return clock.now;
  }
  return null;
}

describe('Heart Moment scheduler', () => {
  it('first surprise after 35–60 minutes of active study, never before', () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = new HeartMomentScheduler(initialState(() => r));
      const clock = { now: 0, last: 0 };
      s.tick({ now: 0, visible: true, lastInteraction: 0, busy: true });
      const fired = study(s, clock, 70 * MIN, { touchEvery: 20_000 });
      expect(fired).not.toBeNull();
      expect(s.state.activeMs).toBeGreaterThanOrEqual(FIRST_RANGE[0]);
      expect(s.state.activeMs).toBeLessThanOrEqual(FIRST_RANGE[1] + 60_000);
    }
  });

  it('background, hidden screen and idling are not counted', () => {
    const s = new HeartMomentScheduler(initialState(() => 0));
    const clock = { now: 0, last: 0 };
    s.tick({ now: 0, visible: true, lastInteraction: 0, busy: false });
    study(s, clock, 60 * MIN, { visible: false, touchEvery: 20_000 });
    expect(s.state.activeMs).toBe(0);
    // app open but untouched for an hour: only the first IDLE_MS count
    clock.last = clock.now;
    study(s, clock, 60 * MIN);
    expect(s.state.activeMs).toBeLessThanOrEqual(IDLE_MS + 5000);
  });

  it('a long frozen timer (device asleep) does not credit the gap', () => {
    const s = new HeartMomentScheduler(initialState());
    s.tick({ now: 0, visible: true, lastInteraction: 0, busy: false });
    s.tick({ now: 3 * 60 * MIN, visible: true, lastInteraction: 3 * 60 * MIN, busy: false });
    expect(s.state.activeMs).toBeLessThanOrEqual(30_000);
  });

  it('waits for a calm moment: not while busy, not mid-stroke', () => {
    const s = new HeartMomentScheduler({ ...initialState(), activeMs: 100 * MIN, dueAtMs: 50 * MIN });
    const clock = { now: 0, last: 0 };
    s.tick({ now: 0, visible: true, lastInteraction: 0, busy: true });
    // warm-up of the session first
    expect(study(s, clock, SESSION_WARMUP_MS - 10_000, { touchEvery: 10_000 })).toBeNull();
    expect(study(s, clock, 10 * MIN, { touchEvery: 10_000, busy: true })).toBeNull();
    // writing continuously (last input just now) → still waiting
    clock.now += 5000;
    expect(s.tick({ now: clock.now, visible: true, lastInteraction: clock.now - 100, busy: false })).toBe(false);
    // a pause → shows
    clock.now += 5000;
    expect(s.tick({ now: clock.now, visible: true, lastInteraction: clock.now - 4000, busy: false })).toBe(true);
  });

  it('after a surprise the next one is 45–90 active minutes later; phrases do not repeat within a cycle', () => {
    const s = new HeartMomentScheduler({ ...initialState(), activeMs: 100 * MIN, dueAtMs: 0 });
    const seen: string[] = [];
    for (let i = 0; i < MESSAGES.length; i++) {
      const before = s.state.activeMs;
      seen.push(s.consume());
      expect(s.state.dueAtMs - before).toBeGreaterThanOrEqual(NEXT_RANGE[0]);
      expect(s.state.dueAtMs - before).toBeLessThanOrEqual(NEXT_RANGE[1]);
    }
    expect(new Set(seen).size).toBe(MESSAGES.length);
    // the next cycle never starts with the phrase that ended the previous one
    for (let k = 0; k < 20; k++) {
      const t = new HeartMomentScheduler({ ...initialState(), bag: [], last: 3 }, () => 0.01 * k);
      expect(t.consume()).not.toBe(MESSAGES[3]);
    }
  });

  it('restores persisted state and survives garbage', () => {
    expect(normalizeState(null).activeMs).toBe(0);
    expect(normalizeState({ activeMs: 'x' }).activeMs).toBe(0);
    const s = normalizeState({ activeMs: 5000, dueAtMs: 9000, bag: [1, 99, -1, 2], last: 1, shownCount: 4 });
    expect(s).toMatchObject({ activeMs: 5000, dueAtMs: 9000, bag: [1, 2], shownCount: 4 });
  });
});

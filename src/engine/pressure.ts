import { clamp } from '@/lib/utils';

/**
 * Pressure handling.
 *
 * Not every device reports real pressure: mice report a constant 0.5 while a button is pressed,
 * touches on iOS report 0 or a constant, and some Apple Pencil models (e.g. Apple Pencil USB-C)
 * have no pressure sensor at all. We therefore detect whether a pointer provides *varying*
 * pressure and otherwise fall back to a velocity-based simulation.
 */

export interface PressureCalibration {
  /** 0..1, how strongly pressure affects width. 0.5 is neutral. */
  sensitivity: number;
  /** Raw pressure considered "no pressure" (light touch noise floor). */
  floor: number;
  /** Raw pressure considered "full pressure". Apple Pencil rarely exceeds ~0.8 when writing. */
  ceiling: number;
}

export const DEFAULT_CALIBRATION: PressureCalibration = { sensitivity: 0.5, floor: 0.02, ceiling: 0.75 };

/** Per-pen pressure response. */
export interface PenPressure {
  /** false = constant width (pressure ignored). */
  enabled: boolean;
  preset: 'soft' | 'balanced' | 'strong' | 'custom';
  /** Response curve exponent: <1 light touch already gives width, >1 needs force. */
  gamma: number;
  /** Width at zero pressure as a fraction of the maximum width. */
  minRatio: number;
  /** 0..1 extra smoothing of the pressure signal. */
  smoothing: number;
}

export const PRESSURE_PRESETS: Record<'soft' | 'balanced' | 'strong', Pick<PenPressure, 'gamma' | 'minRatio'>> = {
  soft: { gamma: 0.6, minRatio: 0.45 },
  balanced: { gamma: 1, minRatio: 0.3 },
  strong: { gamma: 1.6, minRatio: 0.12 },
};

export const DEFAULT_PEN_PRESSURE: PenPressure = { enabled: true, preset: 'balanced', gamma: 1, minRatio: 0.3, smoothing: 0.3 };

/** Raw device pressure → calibrated linear 0..1 (floor/ceiling only, no curve). */
export function linearPressure(raw: number, cal: Pick<PressureCalibration, 'floor' | 'ceiling'> = DEFAULT_CALIBRATION): number {
  if (!Number.isFinite(raw)) return 0.5;
  return clamp((raw - cal.floor) / Math.max(0.05, cal.ceiling - cal.floor), 0, 1);
}

/** Applies the pen's response curve. */
export function applyCurve(p: number, gamma: number): number {
  return Math.pow(clamp(p, 0, 1), clamp(gamma, 0.2, 4));
}

/** Map raw pointer pressure to calibrated 0..1. */
export function normalizePressure(raw: number, cal: PressureCalibration = DEFAULT_CALIBRATION): number {
  if (!Number.isFinite(raw)) return 0.5;
  const n = clamp((raw - cal.floor) / Math.max(0.05, cal.ceiling - cal.floor), 0, 1);
  // sensitivity 0 -> gamma 2.2 (needs heavy hand), 0.5 -> 1, 1 -> 0.45 (very responsive)
  const s = clamp(cal.sensitivity, 0, 1);
  const gamma = s <= 0.5 ? 2.2 - 2.4 * s : 1 - 1.1 * (s - 0.5);
  return Math.pow(n, gamma);
}

/**
 * Tracks the pressure values a pointer has reported during a stroke and decides whether
 * they are real. A real sensor produces non-constant values that are not exactly 0 or 0.5.
 */
export class PressureDetector {
  private first: number | null = null;
  private varied = false;
  private samples = 0;

  constructor(private readonly pointerType: string) {}

  add(raw: number): void {
    this.samples++;
    if (this.first === null) this.first = raw;
    else if (Math.abs(raw - this.first) > 0.004) this.varied = true;
  }

  /** True when the stream looks like a real pressure sensor. */
  get hasRealPressure(): boolean {
    if (this.pointerType === 'mouse') return false;
    if (this.first === null) return false;
    if (this.varied) return true;
    // A single non-trivial pen sample: optimistic until proven constant.
    return this.pointerType === 'pen' && this.samples < 3 && this.first > 0 && this.first !== 0.5 && this.first !== 1;
  }
}

/**
 * Velocity-based pressure simulation for devices without a pressure sensor: faster movement
 * produces thinner lines, like a real fountain pen. Output is smoothed to avoid width jitter.
 */
export class SimulatedPressure {
  private value = 0.6;
  private started = false;

  /** speed in document units per millisecond */
  next(speed: number): number {
    const target = clamp(1 - speed / 2.2, 0.25, 1) * 0.85;
    if (!this.started) {
      this.started = true;
      this.value = target;
    } else {
      this.value += (target - this.value) * 0.25;
    }
    return this.value;
  }
}

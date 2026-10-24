import { create } from 'zustand';
import { getDB } from '@/db/db';
import { setSetting } from '@/db/repo';
import { DEFAULT_CALIBRATION, DEFAULT_PEN_PRESSURE, PRESSURE_PRESETS, type PenPressure, type PressureCalibration } from '@/engine/pressure';
import type { ToolConfig } from '@/engine/tools';
import type { PenStyle } from '@/model/types';
import type { ThemeId } from '@/lib/theme';

export type ThemePref = ThemeId;
export type SortKey = 'updated' | 'created' | 'title' | 'opened';

export type ToolSettings = Omit<ToolConfig, 'smoothing' | 'calibration'>;

export const PEN_COLORS = ['#1c1c1e', '#0a84ff', '#ff3b30', '#34c759', '#ff9500', '#af52de', '#8e8e93', '#ffffff', '#5856d6', '#a2845e', '#ff2d55', '#00c7be'];
export const SHAPE_FILLS = ['#fde2ec', '#f8c8dc', '#ffe8b8', '#d9f2e3', '#d8e8fb', '#e6dcfa', '#1c1c1e', '#ffffff'];
export const HIGHLIGHTER_COLORS = ['#ffd60a', '#a4f06d', '#5ac8fa', '#ff9fd1', '#ffb340', '#c7a4ff'];

export type PenParams = Pick<ToolSettings['pen'], 'width' | 'opacity' | 'stabilization'> & { pressure?: PenPressure };

/** Per-style defaults; the user's changes are remembered per style in `penMemory`. */
export const PEN_DEFAULTS: Record<Exclude<PenStyle, 'ball'>, PenParams> = {
  ballpoint: { width: 1.6, opacity: 1, stabilization: 0.45, pressure: { ...DEFAULT_PEN_PRESSURE, preset: 'soft', ...PRESSURE_PRESETS.soft } },
  fountain: { width: 2.2, opacity: 1, stabilization: 0.5, pressure: { ...DEFAULT_PEN_PRESSURE } },
  calligraphy: { width: 5.5, opacity: 1, stabilization: 0.55, pressure: { ...DEFAULT_PEN_PRESSURE, preset: 'strong', ...PRESSURE_PRESETS.strong } },
  brush: { width: 6, opacity: 1, stabilization: 0.35, pressure: { ...DEFAULT_PEN_PRESSURE, preset: 'strong', ...PRESSURE_PRESETS.strong } },
  fineliner: { width: 1, opacity: 1, stabilization: 0.4 },
  pencil: { width: 1.6, opacity: 0.9, stabilization: 0.35 },
  marker: { width: 5, opacity: 0.9, stabilization: 0.3 },
  monoline: { width: 2, opacity: 1, stabilization: 0.6 },
};

export const PEN_PRESETS: { id: string; label: string; style: Exclude<PenStyle, 'ball'>; params: PenParams }[] = [
  { id: 'quick', label: 'Быстрые заметки', style: 'ballpoint', params: { width: 1.6, opacity: 1, stabilization: 0.25 } },
  { id: 'neat', label: 'Аккуратный почерк', style: 'fountain', params: { width: 2, opacity: 1, stabilization: 0.6 } },
  { id: 'calligraphy', label: 'Каллиграфия', style: 'calligraphy', params: { width: 6, opacity: 1, stabilization: 0.6 } },
  { id: 'drawing', label: 'Рисование', style: 'brush', params: { width: 5, opacity: 1, stabilization: 0.2 } },
];

export const STABILIZATION_LEVELS = [
  { value: 0, label: 'Выкл.' },
  { value: 0.3, label: 'Слабая' },
  { value: 0.55, label: 'Средняя' },
  { value: 0.8, label: 'Сильная' },
];

export const DEFAULT_TOOLS: ToolSettings = {
  tool: 'pen',
  pen: { color: '#1c1c1e', width: 2.2, opacity: 1, style: 'fountain', stabilization: 0.5, pressure: { ...DEFAULT_PEN_PRESSURE }, calligraphyMode: 'pressure' },
  highlighter: { color: '#ffd60a', width: 14, opacity: 0.38, snapToText: true },
  eraser: { mode: 'partial', size: 24 },
  lasso: { mode: 'free' },
  shape: { kind: 'auto', color: '#1c1c1e', width: 2, fill: null, opacity: 1 },
  text: { fontFamily: 'system', fontSize: 16, color: '#1c1c1e', align: 'left' },
};

export interface SettingsState {
  loaded: boolean;
  /** Stored under its own key so the pre-v2 'light/dark' values are not misread. */
  themeId: ThemePref;
  stylusOnly: boolean;
  calibration: PressureCalibration;
  smoothing: number;
  libraryView: 'grid' | 'list';
  sort: SortKey;
  onboardingDone: boolean;
  showPerf: boolean;
  tools: ToolSettings;
  quickPenColors: string[];
  lastBackupAt: number;
  storageNoticeDismissed: boolean;
  openTabs: string[];
  penMemory: Partial<Record<PenStyle, PenParams>>;
}

const DEFAULTS: Omit<SettingsState, 'loaded'> = {
  themeId: 'system',
  stylusOnly: true,
  calibration: DEFAULT_CALIBRATION,
  smoothing: 0.5,
  libraryView: 'grid',
  sort: 'updated',
  onboardingDone: false,
  showPerf: false,
  tools: DEFAULT_TOOLS,
  quickPenColors: ['#1c1c1e', '#0a84ff', '#ff3b30'],
  lastBackupAt: 0,
  storageNoticeDismissed: false,
  openTabs: [],
  penMemory: {},
};

type PersistedKey = keyof typeof DEFAULTS;

interface SettingsActions {
  load(): Promise<void>;
  set<K extends PersistedKey>(key: K, value: SettingsState[K]): void;
  updateTools(fn: (t: ToolSettings) => ToolSettings): void;
  /** Switch pen style, remembering the current style's parameters and restoring the new one's. */
  selectPenStyle(style: Exclude<PenStyle, 'ball'>, params?: PenParams): void;
}

const pendingWrites = new Map<string, { timer: ReturnType<typeof setTimeout>; value: unknown }>();
/** Keys changed continuously by sliders are debounced; everything else is written immediately. */
const DEBOUNCED = new Set(['tools', 'calibration', 'smoothing', 'penMemory']);

function write(key: string, value: unknown): void {
  void setSetting(key, value).catch(() => {
    /* settings are non-critical; a failed write keeps the in-memory value */
  });
}

function persist(key: string, value: unknown): void {
  const pending = pendingWrites.get(key);
  if (pending) clearTimeout(pending.timer);
  if (!DEBOUNCED.has(key)) {
    pendingWrites.delete(key);
    write(key, value);
    return;
  }
  pendingWrites.set(key, {
    value,
    timer: setTimeout(() => {
      pendingWrites.delete(key);
      write(key, value);
    }, 250),
  });
}

/** Write debounced settings now (page hidden / closing). */
export function flushSettings(): void {
  for (const [key, { timer, value }] of pendingWrites) {
    clearTimeout(timer);
    write(key, value);
  }
  pendingWrites.clear();
}

export const useSettings = create<SettingsState & SettingsActions>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  async load() {
    const patch: Partial<SettingsState> = {};
    try {
      const rows = await getDB().settings.toArray();
      for (const row of rows) {
        if (row.key in DEFAULTS) (patch as Record<string, unknown>)[row.key] = row.value;
      }
    } catch {
      /* storage unavailable: run with defaults */
    }
    // Merge nested tool settings so new fields added in updates get their defaults.
    const tools = patch.tools ? mergeTools(patch.tools) : DEFAULTS.tools;
    set({ ...patch, tools, loaded: true });
  },
  set(key, value) {
    set({ [key]: value } as Partial<SettingsState>);
    persist(key, value);
  },
  updateTools(fn) {
    const tools = fn(get().tools);
    set({ tools });
    persist('tools', tools);
  },
  selectPenStyle(style, params) {
    const { tools, penMemory } = get();
    const cur = tools.pen;
    const memory = { ...penMemory, [cur.style]: { width: cur.width, opacity: cur.opacity, stabilization: cur.stabilization, pressure: cur.pressure } };
    const next = params ?? memory[style] ?? PEN_DEFAULTS[style];
    const updated: ToolSettings = { ...tools, tool: 'pen', pen: { ...cur, style, ...next, pressure: { ...DEFAULT_PEN_PRESSURE, ...(next.pressure ?? PEN_DEFAULTS[style].pressure) } } };
    set({ tools: updated, penMemory: memory });
    persist('tools', updated);
    persist('penMemory', memory);
  },
}));

function mergeTools(saved: Partial<ToolSettings>): ToolSettings {
  const d = DEFAULT_TOOLS;
  return {
    tool: saved.tool ?? d.tool,
    pen: { ...d.pen, ...saved.pen, pressure: { ...d.pen.pressure, ...saved.pen?.pressure }, style: saved.pen?.style === 'ball' ? 'ballpoint' : (saved.pen?.style ?? d.pen.style) },
    highlighter: { ...d.highlighter, ...saved.highlighter },
    eraser: { ...d.eraser, ...saved.eraser },
    lasso: { ...d.lasso, ...saved.lasso },
    shape: { ...d.shape, ...saved.shape, kind: (saved.shape?.kind as string) === 'circle' ? 'ellipse' : (saved.shape?.kind ?? d.shape.kind) },
    text: { ...d.text, ...saved.text },
  };
}

export function toolConfigFrom(s: Pick<SettingsState, 'tools' | 'smoothing' | 'calibration'>): ToolConfig {
  return { ...s.tools, smoothing: s.smoothing, calibration: s.calibration };
}

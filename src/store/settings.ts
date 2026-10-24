import { create } from 'zustand';
import { getDB } from '@/db/db';
import { setSetting } from '@/db/repo';
import { DEFAULT_CALIBRATION, type PressureCalibration } from '@/engine/pressure';
import type { ToolConfig } from '@/engine/tools';

export type ThemePref = 'system' | 'light' | 'dark';
export type SortKey = 'updated' | 'created' | 'title' | 'opened';

export type ToolSettings = Omit<ToolConfig, 'smoothing' | 'calibration'>;

export const PEN_COLORS = ['#1c1c1e', '#0a84ff', '#ff3b30', '#34c759', '#ff9500', '#af52de', '#8e8e93', '#ffffff', '#5856d6', '#a2845e', '#ff2d55', '#00c7be'];
export const HIGHLIGHTER_COLORS = ['#ffd60a', '#a4f06d', '#5ac8fa', '#ff9fd1', '#ffb340', '#c7a4ff'];

export const DEFAULT_TOOLS: ToolSettings = {
  tool: 'pen',
  pen: { color: '#1c1c1e', width: 2.2, opacity: 1, style: 'fountain' },
  highlighter: { color: '#ffd60a', width: 14, opacity: 0.38, snapToText: true },
  eraser: { mode: 'partial', size: 24 },
  lasso: { mode: 'free' },
  shape: { kind: 'auto', color: '#1c1c1e', width: 2 },
  text: { fontFamily: 'system', fontSize: 16, color: '#1c1c1e', align: 'left' },
};

export interface SettingsState {
  loaded: boolean;
  theme: ThemePref;
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
}

const DEFAULTS: Omit<SettingsState, 'loaded'> = {
  theme: 'system',
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
};

type PersistedKey = keyof typeof DEFAULTS;

interface SettingsActions {
  load(): Promise<void>;
  set<K extends PersistedKey>(key: K, value: SettingsState[K]): void;
  updateTools(fn: (t: ToolSettings) => ToolSettings): void;
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function persist(key: string, value: unknown): void {
  const t = pendingWrites.get(key);
  if (t) clearTimeout(t);
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      void setSetting(key, value).catch(() => {
        /* settings are non-critical; a failed write keeps the in-memory value */
      });
    }, 250),
  );
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
}));

function mergeTools(saved: Partial<ToolSettings>): ToolSettings {
  const d = DEFAULT_TOOLS;
  return {
    tool: saved.tool ?? d.tool,
    pen: { ...d.pen, ...saved.pen },
    highlighter: { ...d.highlighter, ...saved.highlighter },
    eraser: { ...d.eraser, ...saved.eraser },
    lasso: { ...d.lasso, ...saved.lasso },
    shape: { ...d.shape, ...saved.shape },
    text: { ...d.text, ...saved.text },
  };
}

export function toolConfigFrom(s: Pick<SettingsState, 'tools' | 'smoothing' | 'calibration'>): ToolConfig {
  return { ...s.tools, smoothing: s.smoothing, calibration: s.calibration };
}

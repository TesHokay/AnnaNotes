import { useEffect, useRef } from 'react';
import { ColorSwatch, Label, Segmented, Slider, Switch } from '@/components/ui/controls';
import { strokeOutline, tracePolygon } from '@/engine/outline';
import { PRESSURE_PRESETS, type PenPressure } from '@/engine/pressure';
import { strokeFillStyle } from '@/engine/renderer';
import { PRESSURE_STYLES } from '@/engine/tools';
import { cn } from '@/lib/utils';
import type { PenStyle, StrokePoint } from '@/model/types';
import { PEN_COLORS, PEN_PRESETS, STABILIZATION_LEVELS, useSettings } from '@/store/settings';

export const PEN_STYLES: { style: Exclude<PenStyle, 'ball'>; label: string; hint: string }[] = [
  { style: 'ballpoint', label: 'Шариковая', hint: 'Ровная линия, лёгкая реакция на нажатие' },
  { style: 'fountain', label: 'Перьевая', hint: 'Нажатие и наклон пера 45°' },
  { style: 'calligraphy', label: 'Каллиграфия', hint: 'Острое перо: волосные восходящие, толстые нисходящие' },
  { style: 'brush', label: 'Кисть', hint: 'Сильная реакция на нажатие, мягкие окончания' },
  { style: 'fineliner', label: 'Линер', hint: 'Тонкая ровная линия' },
  { style: 'pencil', label: 'Карандаш', hint: 'Зернистая текстура графита' },
  { style: 'marker', label: 'Маркер', hint: 'Широкая плотная линия с прозрачностью' },
  { style: 'monoline', label: 'Монолиния', hint: 'Идеально ровная толщина для схем' },
];

/** Synthetic handwriting sample with natural pressure: heavier on downstrokes. */
function samplePoints(w: number, h: number, loops = 2): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const n = 70 * loops;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 2 * loops;
    const x = w * 0.08 + t * w * 0.84 + Math.sin(a) * h * 0.18;
    const y = h / 2 - Math.cos(a) * h * 0.3;
    const down = Math.sin(a) > 0 ? 0.9 : 0.25;
    pts.push({ x, y, pressure: down * (0.45 + 0.55 * Math.sin(t * Math.PI)), timestamp: i * 8, tiltX: 0, tiltY: 0 });
  }
  return pts;
}

export function StrokePreview({ style, width, color, opacity, minWidthRatio, className, loops }: { style: PenStyle; width: number; color: string; opacity: number; minWidthRatio?: number; className?: string; loops?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 100;
    const h = c.clientHeight || 40;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const path = new Path2D();
    tracePolygon(path, strokeOutline({ points: samplePoints(w, h, loops), baseWidth: Math.min(width, h * 0.3), tool: 'pen', penStyle: style, minWidthRatio }));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = strokeFillStyle(ctx, color, style);
    ctx.fill(path);
  }, [style, width, color, opacity, minWidthRatio, loops]);
  return <canvas ref={ref} className={cn('block w-full rounded-md bg-white', className)} aria-hidden />;
}

/** Curve preview: width vs pressure for the current settings. */
function CurveGraph({ p }: { p: PenPressure }) {
  const pts = Array.from({ length: 21 }, (_, i) => {
    const x = i / 20;
    const y = p.enabled ? p.minRatio + (1 - p.minRatio) * Math.pow(x, p.gamma) : 1;
    return `${(x * 100).toFixed(1)},${(100 - y * 100).toFixed(1)}`;
  });
  return (
    <svg viewBox="-4 -4 108 108" className="h-20 w-20 shrink-0 rounded-md bg-muted/60" aria-label="Кривая отклика">
      <path d="M0 100 H100 M0 0 V100" stroke="currentColor" strokeOpacity={0.2} fill="none" />
      <polyline points={pts.join(' ')} fill="none" stroke="hsl(var(--primary))" strokeWidth={4} strokeLinecap="round" />
    </svg>
  );
}

export function PenOptions() {
  const pen = useSettings((s) => s.tools.pen);
  const update = useSettings((s) => s.updateTools);
  const selectStyle = useSettings((s) => s.selectPenStyle);
  const quick = useSettings((s) => s.quickPenColors);
  const setSetting = useSettings((s) => s.set);
  const style = pen.style === 'ball' ? 'ballpoint' : pen.style;
  const setPen = (patch: Partial<typeof pen>) => update((t) => ({ ...t, pen: { ...t.pen, ...patch } }));
  const setPressure = (patch: Partial<PenPressure>) => update((t) => ({ ...t, pen: { ...t.pen, pressure: { ...t.pen.pressure, ...patch } } }));
  const pr = pen.pressure;
  const usesMin = PRESSURE_STYLES.has(style);

  return (
    <div className="flex max-h-[min(70dvh,640px)] flex-col gap-4 overflow-y-auto overflow-x-hidden pr-1">
      <StrokePreview style={style} width={pen.width} color={pen.color} opacity={pen.opacity} minWidthRatio={pr.enabled && usesMin ? pr.minRatio : undefined} className="h-16 ring-1 ring-black/5" />
      <div>
        <Label>Тип пера</Label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {PEN_STYLES.map((p) => (
            <button
              key={p.style}
              title={p.hint}
              onClick={() => selectStyle(p.style)}
              aria-pressed={style === p.style}
              data-testid={`pen-style-${p.style}`}
              className={cn(
                'flex min-w-0 flex-col items-stretch gap-1 rounded-md border p-1.5 text-center transition-colors',
                style === p.style ? 'border-primary bg-accent text-accent-foreground' : 'border-transparent bg-muted/60 hover:bg-muted',
              )}
            >
              <StrokePreview style={p.style} width={p.style === 'calligraphy' || p.style === 'brush' || p.style === 'marker' ? 5 : 2} color="#1c1c1e" opacity={p.style === 'marker' ? 0.85 : 1} className="h-7" loops={1} />
              <span className="break-words text-[12px] font-medium leading-tight [hyphens:auto]">{p.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{PEN_STYLES.find((p) => p.style === style)?.hint}</p>
      </div>
      <div>
        <Label>Пресеты</Label>
        <div className="flex flex-wrap gap-1.5">
          {PEN_PRESETS.map((p) => (
            <button key={p.id} onClick={() => selectStyle(p.style, p.params)} className="min-h-9 rounded-full bg-muted/60 px-3 text-[12px] hover:bg-muted">
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Цвет</Label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-2">
          {PEN_COLORS.map((c) => (
            <ColorSwatch
              key={c}
              color={c}
              active={pen.color.toLowerCase() === c.toLowerCase()}
              onClick={() => {
                setPen({ color: c });
                if (!quick.includes(c)) setSetting('quickPenColors', [c, ...quick].slice(0, 3));
              }}
            />
          ))}
          <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border" title="Свой цвет" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
            <input type="color" value={pen.color} onChange={(e) => setPen({ color: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Свой цвет" />
          </label>
        </div>
      </div>
      <Slider label="Максимальная толщина" min={0.4} max={16} step={0.1} value={pen.width} onChange={(width) => setPen({ width })} format={(v) => v.toFixed(1)} />
      <Slider label="Непрозрачность" min={10} max={100} value={Math.round(pen.opacity * 100)} onChange={(v) => setPen({ opacity: v / 100 })} format={(v) => `${v}%`} />

      <section className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
        <Switch checked={pr.enabled} onChange={(enabled) => setPressure({ enabled })} label="Чувствительность к нажатию" description="Слабое нажатие — тонкая линия, сильное — толстая" />
        {pr.enabled && (
          <>
            <Segmented<PenPressure['preset']>
              value={pr.preset}
              onChange={(preset) => setPressure(preset === 'custom' ? { preset } : { preset, ...PRESSURE_PRESETS[preset] })}
              options={[
                { value: 'soft', label: 'Мягкая', title: 'Лёгкое касание уже даёт толщину' },
                { value: 'balanced', label: 'Средняя' },
                { value: 'strong', label: 'Сильная', title: 'Для толстой линии нужно сильнее нажимать' },
                { value: 'custom', label: 'Своя' },
              ]}
            />
            <div className="flex items-center gap-3">
              <CurveGraph p={pr} />
              <div className="min-w-0 flex-1 space-y-2">
                {pr.preset === 'custom' && <Slider label="Кривая отклика" min={40} max={250} value={Math.round(pr.gamma * 100)} onChange={(v) => setPressure({ gamma: v / 100 })} format={(v) => (v / 100).toFixed(2)} />}
                {usesMin && <Slider label="Минимальная толщина" min={5} max={100} value={Math.round(pr.minRatio * 100)} onChange={(v) => setPressure({ minRatio: v / 100, preset: 'custom' })} format={(v) => `${v}%`} />}
              </div>
            </div>
            <Slider label="Сглаживание нажатия" min={0} max={100} value={Math.round(pr.smoothing * 100)} onChange={(v) => setPressure({ smoothing: v / 100 })} format={(v) => `${v}%`} />
          </>
        )}
        {style === 'calligraphy' && (
          <div>
            <Label>Режим каллиграфии</Label>
            <Segmented<'pressure' | 'direction'>
              value={pen.calligraphyMode}
              onChange={(calligraphyMode) => setPen({ calligraphyMode })}
              options={[
                { value: 'pressure', label: 'По нажатию' },
                { value: 'direction', label: 'По направлению' },
              ]}
            />
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
              {pen.calligraphyMode === 'pressure'
                ? 'Толщина нисходящих линий зависит от силы нажатия Apple Pencil. Если перо не передаёт нажатие, используется направление.'
                : 'Имитация: толщина зависит только от направления движения (вниз — толще). Для перьев без датчика нажатия.'}
            </p>
          </div>
        )}
        <p className="text-[12px] leading-snug text-muted-foreground">Проверить, передаёт ли ваше перо нажатие: Настройки → «Диагностика Apple Pencil».</p>
      </section>

      <div>
        <Label>Стабилизация</Label>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {STABILIZATION_LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => setPen({ stabilization: l.value })}
              aria-pressed={Math.abs(pen.stabilization - l.value) < 0.01}
              className={cn('min-h-9 min-w-0 break-words rounded-md px-1 text-[12px] leading-tight', Math.abs(pen.stabilization - l.value) < 0.01 ? 'bg-accent font-medium text-accent-foreground' : 'bg-muted/60 hover:bg-muted')}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Slider label="Точная настройка" min={0} max={100} value={Math.round(pen.stabilization * 100)} onChange={(v) => setPen({ stabilization: v / 100 })} format={(v) => `${v}%`} />
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Сильнее стабилизация — ровнее линия, но она немного отстаёт от пера при медленном письме.</p>
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">Удержите перо в конце линии — она выпрямится или превратится в фигуру.</p>
    </div>
  );
}

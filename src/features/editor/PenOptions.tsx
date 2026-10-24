import { useEffect, useRef } from 'react';
import { ColorSwatch, Label, Slider } from '@/components/ui/controls';
import { strokeOutline, tracePolygon } from '@/engine/outline';
import { strokeFillStyle } from '@/engine/renderer';
import { cn } from '@/lib/utils';
import type { PenStyle, StrokePoint } from '@/model/types';
import { PEN_COLORS, PEN_PRESETS, STABILIZATION_LEVELS, useSettings } from '@/store/settings';

export const PEN_STYLES: { style: Exclude<PenStyle, 'ball'>; label: string; hint: string }[] = [
  { style: 'ballpoint', label: 'Шариковая', hint: 'Ровная линия, почти без реакции на нажатие' },
  { style: 'fountain', label: 'Перьевая', hint: 'Лёгкая вариативность: нажатие и наклон пера 45°' },
  { style: 'calligraphy', label: 'Каллиграфия', hint: 'Острое перо: тонкие восходящие, толстые нисходящие с нажимом' },
  { style: 'brush', label: 'Кисть', hint: 'Сильная реакция на нажатие, мягкие сужения на концах' },
  { style: 'fineliner', label: 'Линер', hint: 'Тонкая ровная линия' },
  { style: 'pencil', label: 'Карандаш', hint: 'Зернистая текстура графита' },
  { style: 'marker', label: 'Маркер', hint: 'Широкая плотная линия с прозрачностью' },
  { style: 'monoline', label: 'Монолиния', hint: 'Идеально ровная толщина для схем' },
];

/** Synthetic handwriting sample: a looping "l-e" flourish with natural pressure. */
function samplePoints(w: number, h: number): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const n = 140;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 4;
    const x = 14 + t * (w - 28) + Math.sin(a) * 14;
    const y = h / 2 - Math.cos(a) * (h * 0.32) * (0.6 + 0.4 * Math.sin(t * Math.PI));
    // Heavier on the way down, lighter on upstrokes, like real writing.
    const down = Math.sin(a) > 0 ? 0.85 : 0.35;
    pts.push({ x, y, pressure: down * (0.4 + 0.6 * Math.sin(t * Math.PI)), timestamp: i * 8, tiltX: 0, tiltY: 0 });
  }
  return pts;
}

export function StrokePreview({ style, width, color, opacity }: { style: PenStyle; width: number; color: string; opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const path = new Path2D();
    tracePolygon(path, strokeOutline({ points: samplePoints(w, h), baseWidth: width, tool: 'pen', penStyle: style }));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = strokeFillStyle(ctx, color, style);
    ctx.fill(path);
  }, [style, width, color, opacity]);
  return <canvas ref={ref} className="h-16 w-full rounded-md bg-white ring-1 ring-black/5" aria-label="Предпросмотр линии" />;
}

export function PenOptions() {
  const pen = useSettings((s) => s.tools.pen);
  const update = useSettings((s) => s.updateTools);
  const selectStyle = useSettings((s) => s.selectPenStyle);
  const quick = useSettings((s) => s.quickPenColors);
  const setSetting = useSettings((s) => s.set);
  const style = pen.style === 'ball' ? 'ballpoint' : pen.style;
  const setPen = (patch: Partial<typeof pen>) => update((t) => ({ ...t, pen: { ...t.pen, ...patch } }));

  return (
    <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto pr-1">
      <StrokePreview style={style} width={pen.width} color={pen.color} opacity={pen.opacity} />
      <div>
        <Label>Тип пера</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PEN_STYLES.map((p) => (
            <button
              key={p.style}
              title={p.hint}
              onClick={() => selectStyle(p.style)}
              aria-pressed={style === p.style}
              className={cn('min-h-10 rounded-md px-1 text-[12px] leading-tight', style === p.style ? 'bg-accent font-medium text-accent-foreground' : 'bg-muted/60 hover:bg-muted')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{PEN_STYLES.find((p) => p.style === style)?.hint}</p>
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
        <div className="grid grid-cols-7 gap-2">
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
            <input type="color" value={pen.color} onChange={(e) => setPen({ color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Свой цвет" />
          </label>
        </div>
      </div>
      <Slider label="Толщина" min={0.4} max={16} step={0.1} value={pen.width} onChange={(width) => setPen({ width })} format={(v) => v.toFixed(1)} />
      <Slider label="Непрозрачность" min={10} max={100} value={Math.round(pen.opacity * 100)} onChange={(v) => setPen({ opacity: v / 100 })} format={(v) => `${v}%`} />
      <div>
        <Label>Стабилизация</Label>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {STABILIZATION_LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => setPen({ stabilization: l.value })}
              aria-pressed={Math.abs(pen.stabilization - l.value) < 0.01}
              className={cn('min-h-9 rounded-md text-[12px]', Math.abs(pen.stabilization - l.value) < 0.01 ? 'bg-accent font-medium text-accent-foreground' : 'bg-muted/60 hover:bg-muted')}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Slider label="Точная настройка" min={0} max={100} value={Math.round(pen.stabilization * 100)} onChange={(v) => setPen({ stabilization: v / 100 })} format={(v) => `${v}%`} />
        <p className="mt-1 text-[12px] text-muted-foreground">Сильнее стабилизация — ровнее линия, но она немного отстаёт от пера при медленном письме.</p>
      </div>
      <p className="text-[12px] text-muted-foreground">Удержите перо в конце линии — она выпрямится или превратится в фигуру.</p>
    </div>
  );
}

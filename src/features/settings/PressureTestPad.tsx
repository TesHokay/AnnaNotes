import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { strokeOutline, tracePolygon } from '@/engine/outline';
import { applyCurve, linearPressure } from '@/engine/pressure';
import { strokeFillStyle } from '@/engine/renderer';
import { PRESSURE_STYLES } from '@/engine/tools';
import type { StrokePoint } from '@/model/types';
import { useSettings } from '@/store/settings';

interface Stats {
  type: string;
  pressure: number;
  min: number;
  max: number;
  tiltX: number;
  tiltY: number;
  rate: number;
  varying: boolean;
  samples: number;
}

/**
 * Apple Pencil diagnostics: shows what the device actually reports (pointer type, raw pressure
 * range, tilt, event rate) and lets the user draw test lines with the current pen settings.
 * This is how we avoid claiming pressure support the hardware/browser does not provide.
 */
export function PressureTestPad() {
  const pen = useSettings((s) => s.tools.pen);
  const calibration = useSettings((s) => s.calibration);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ points: StrokePoint[]; simulated: boolean }[]>([]);
  const current = useRef<StrokePoint[] | null>(null);
  const first = useRef<number | null>(null);
  const events = useRef<number[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const style = pen.style === 'ball' ? 'ballpoint' : pen.style;

  const redraw = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const all = current.current ? [...strokes.current, { points: current.current, simulated: !(stats?.varying ?? false) }] : strokes.current;
    ctx.fillStyle = strokeFillStyle(ctx, pen.color, style);
    ctx.globalAlpha = pen.opacity;
    for (const s of all) {
      const path = new Path2D();
      tracePolygon(path, strokeOutline({ points: s.points, baseWidth: pen.width * 1.5, tool: 'pen', penStyle: style, simulatedPressure: s.simulated, minWidthRatio: pen.pressure.enabled && PRESSURE_STYLES.has(style) ? pen.pressure.minRatio : undefined }));
      ctx.fill(path);
    }
  };

  useEffect(redraw);

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const native = e.nativeEvent;
    const list = typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length ? native.getCoalescedEvents() : [native];
    const now = performance.now();
    if (e.type === 'pointerdown') {
      first.current = e.pressure;
      current.current = [];
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (e.type !== 'pointerup' && e.buttons === 0) return;
    events.current.push(...list.map(() => now));
    while (events.current.length && now - events.current[0]! > 1000) events.current.shift();
    const rect = e.currentTarget.getBoundingClientRect();
    if (current.current && e.type !== 'pointerup') {
      for (const ev of list) {
        const p = pen.pressure.enabled ? applyCurve(linearPressure(ev.pressure, calibration), pen.pressure.gamma) : 1;
        current.current.push({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, pressure: p, timestamp: ev.timeStamp, tiltX: ev.tiltX, tiltY: ev.tiltY });
      }
    }
    const varying = first.current !== null && Math.abs(e.pressure - first.current) > 0.004;
    setStats((prev) => ({
      type: e.pointerType,
      pressure: e.pressure,
      min: e.type === 'pointerdown' || !prev ? e.pressure : Math.min(prev.min, e.pressure || prev.min),
      max: e.type === 'pointerdown' || !prev ? e.pressure : Math.max(prev.max, e.pressure),
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      rate: events.current.length,
      varying: (prev?.varying && e.type !== 'pointerdown') || varying,
      samples: (e.type === 'pointerdown' ? 0 : (prev?.samples ?? 0)) + list.length,
    }));
    if (e.type === 'pointerup' && current.current) {
      if (current.current.length > 1) strokes.current.push({ points: current.current, simulated: !varying && !(stats?.varying ?? false) });
      current.current = null;
    }
    redraw();
  };

  const realPressure = stats ? stats.type === 'pen' && stats.varying : null;
  return (
    <div className="flex flex-col gap-2" data-testid="pencil-diagnostics">
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerUp={onPointer}
          className="drawing-surface h-36 w-full rounded-md border border-dashed bg-white"
          aria-label="Тестовая область: проведите линии с разной силой нажатия"
        />
        {!stats && <span className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-[13px] text-muted-foreground">Проведите здесь несколько линий пером — слабо и сильно</span>}
        <button
          type="button"
          onClick={() => {
            strokes.current = [];
            setStats(null);
          }}
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground"
          aria-label="Очистить тестовую область"
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>
      {stats && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
          <span className="text-muted-foreground">Тип указателя</span>
          <b className="sm:col-span-2">{stats.type === 'pen' ? 'перо (pen)' : stats.type === 'touch' ? 'палец (touch)' : stats.type}</b>
          <span className="text-muted-foreground">Давление</span>
          <b className="sm:col-span-2 tabular-nums">
            {stats.pressure.toFixed(3)} (мин. {stats.min.toFixed(3)}, макс. {stats.max.toFixed(3)})
          </b>
          <span className="text-muted-foreground">Наклон X / Y</span>
          <b className="sm:col-span-2 tabular-nums">
            {stats.tiltX}° / {stats.tiltY}°
          </b>
          <span className="text-muted-foreground">Событий в секунду</span>
          <b className="sm:col-span-2 tabular-nums">{stats.rate}</b>
        </div>
      )}
      {realPressure !== null && (
        <p className={`rounded-md p-2 text-[13px] leading-snug ${realPressure ? 'bg-[#2f9e5b]/10 text-[#22764a]' : 'bg-[#ff9500]/10 text-[#b25f00] dark:text-[#ffb340]'}`}>
          {realPressure
            ? 'Датчик давления работает: толщина линий следует за силой нажатия.'
            : stats?.type === 'pen'
              ? 'Перо не передаёт силу нажатия (например, Apple Pencil USB-C). Толщина будет имитироваться по скорости, а у каллиграфии — по направлению.'
              : 'Это не Apple Pencil. Давление пальца или мыши браузер не передаёт — используется имитация по скорости.'}
        </p>
      )}
    </div>
  );
}

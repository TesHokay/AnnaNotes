import { useRef, useState } from 'react';

/**
 * Lets the user see what their device actually reports: pointer type, raw pressure and tilt.
 * This is how we avoid claiming pressure support that the browser/device does not provide.
 */
export function PressureTestPad() {
  const [info, setInfo] = useState<{ type: string; pressure: number; max: number; tiltX: number; tiltY: number; varying: boolean } | null>(null);
  const first = useRef<number | null>(null);
  const max = useRef(0);

  const onPointer = (e: React.PointerEvent) => {
    if (e.type === 'pointerdown') {
      first.current = e.pressure;
      max.current = 0;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (e.buttons === 0 && e.type !== 'pointerup') return;
    max.current = Math.max(max.current, e.pressure);
    setInfo({
      type: e.pointerType,
      pressure: e.pressure,
      max: max.current,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      varying: first.current !== null && Math.abs(e.pressure - first.current) > 0.004,
    });
  };

  return (
    <div
      onPointerDown={onPointer}
      onPointerMove={onPointer}
      onPointerUp={onPointer}
      className="drawing-surface flex h-24 flex-col items-center justify-center rounded-md border border-dashed text-center text-[13px] text-muted-foreground"
    >
      {info ? (
        <>
          <div>
            Устройство: <b className="text-foreground">{info.type}</b> · давление {info.pressure.toFixed(2)} (макс. {info.max.toFixed(2)})
          </div>
          <div>
            Наклон: {info.tiltX}° / {info.tiltY}° · {info.varying ? 'датчик давления работает' : 'давление не меняется — будет имитация по скорости'}
          </div>
        </>
      ) : (
        'Проведите здесь пером, чтобы проверить давление и наклон'
      )}
    </div>
  );
}

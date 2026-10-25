import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BringToFront, Check, Copy, CopyPlus, FlipHorizontal2, FlipVertical2, Maximize2, Minus, Plus, Scissors, SendToBack, SlidersHorizontal, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorSwatch, Input, Label, Slider } from '@/components/ui/controls';
import type { SelectionInfo } from '@/engine/DrawingEngine';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import { FONT_STACKS, LINE_HEIGHT, TEXT_PADDING } from '@/engine/text';
import { useSession } from '@/editor/session';
import type { TextElement } from '@/model/types';
import { useEditor } from '@/store/editor';
import { PEN_COLORS, SHAPE_FILLS, useSettings } from '@/store/settings';
import { TextOptions } from './Toolbar';

/** Floating actions for the lasso selection, positioned above (or below) the selection box. */
export function SelectionBar() {
  const sel = useEditor((s) => s.selection);
  const session = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!sel || !ref.current) return setPos(null);
    const parent = ref.current.parentElement!.getBoundingClientRect();
    const bar = ref.current.getBoundingClientRect();
    const r = sel.screenRect;
    let top = r.y - bar.height - 44;
    if (top < 8) top = r.y + r.height + 16;
    if (top + bar.height > parent.height - 8) top = Math.max(8, parent.height - bar.height - 72);
    const left = Math.min(Math.max(8, r.x + r.width / 2 - bar.width / 2), parent.width - bar.width - 8);
    setPos({ left, top });
  }, [sel]);

  if (!sel) return null;
  const e = session.engine;
  return (
    <div
      ref={ref}
      className="glass absolute z-10 flex items-center gap-0.5 rounded-full border p-1 shadow-float"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onPointerDown={(ev) => ev.stopPropagation()}
      data-testid="selection-bar"
    >
      {sel.shape && <ShapeStylePopover shape={sel.shape} />}
      {sel.image && <ImageStylePopover image={sel.image} />}
      {(sel.shape || sel.image) && (
        <>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="На передний план" title="На передний план" onClick={() => e?.arrangeSelection('front')}>
            <BringToFront className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="На задний план" title="На задний план" onClick={() => e?.arrangeSelection('back')}>
            <SendToBack className="h-4 w-4" />
          </Button>
        </>
      )}
      {(sel.hasStrokes || sel.hasText) && !sel.shape && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full" aria-label="Цвет выделенного">
              <span className="h-5 w-5 rounded-full" style={{ background: 'conic-gradient(#ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)' }} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3">
            <div className="grid grid-cols-6 gap-2">
              {PEN_COLORS.map((c) => (
                <ColorSwatch key={c} color={c} onClick={() => e?.recolorSelection(c)} />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {sel.hasText && sel.count === 1 && (
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => e?.editSelectedText()}>
          <Type className="h-4 w-4" /> Изменить
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Копировать" title="Копировать" onClick={() => e?.copySelection()}>
        <Copy className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Вырезать" title="Вырезать" onClick={() => e?.cutSelection()}>
        <Scissors className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Дублировать" title="Дублировать" onClick={() => e?.duplicateSelection()}>
        <CopyPlus className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" className="rounded-full text-destructive" aria-label="Удалить" title="Удалить" onClick={() => e?.deleteSelection()}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Sticker / image options: mirroring and opacity (move, resize and rotate use the frame). */
function ImageStylePopover({ image }: { image: NonNullable<SelectionInfo['image']> }) {
  const e = useSession().engine;
  return (
    <>
      <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Отразить по горизонтали" title="Отразить по горизонтали" aria-pressed={image.flipX} onClick={() => e?.updateSelectedImages({ flipX: !image.flipX })}>
        <FlipHorizontal2 className="h-4 w-4" />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={image.sticker ? 'Настройки стикера' : 'Настройки изображения'} title="Прозрачность и отражение" data-testid="image-style">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(18rem,calc(100vw-24px))]" onOpenAutoFocus={(ev) => ev.preventDefault()}>
          <div className="flex flex-col gap-4">
            <Slider label="Непрозрачность" min={10} max={100} value={Math.round(image.opacity * 100)} onChange={(v) => e?.updateSelectedImages({ opacity: v / 100 })} format={(v) => `${v}%`} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant={image.flipX ? 'default' : 'secondary'} size="sm" onClick={() => e?.updateSelectedImages({ flipX: !image.flipX })}>
                <FlipHorizontal2 className="h-4 w-4" /> По горизонтали
              </Button>
              <Button variant={image.flipY ? 'default' : 'secondary'} size="sm" onClick={() => e?.updateSelectedImages({ flipY: !image.flipY })}>
                <FlipVertical2 className="h-4 w-4" /> По вертикали
              </Button>
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">Тяните угловые ручки — размер, верхнюю точку — поворот.</p>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function ShapeStylePopover({ shape }: { shape: NonNullable<SelectionInfo['shape']> }) {
  const session = useSession();
  const e = session.engine;
  const closed = shape.kind !== 'line' && shape.kind !== 'arrow';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full" aria-label="Стиль фигуры" data-testid="shape-style">
          <span className="h-5 w-5 rounded-full border-[3px]" style={{ borderColor: shape.stroke, background: shape.fill ?? 'transparent' }} />
          Стиль
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-24px))]" onOpenAutoFocus={(ev) => ev.preventDefault()}>
        <div className="flex flex-col gap-4">
          <div>
            <Label>Обводка</Label>
            <div className="grid grid-cols-6 gap-2">
              {PEN_COLORS.map((c) => (
                <ColorSwatch key={c} color={c} active={shape.stroke.toLowerCase() === c} onClick={() => e?.updateSelectedShapes({ stroke: c })} />
              ))}
            </div>
          </div>
          {closed && (
            <div>
              <Label>Заливка</Label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => e?.updateSelectedShapes({ fill: null })}
                  aria-pressed={shape.fill === null}
                  className={cn('h-8 rounded-full border px-3 text-[12px]', shape.fill === null && 'border-primary bg-accent text-accent-foreground')}
                  data-testid="fill-none"
                >
                  Нет
                </button>
                {SHAPE_FILLS.map((c) => (
                  <ColorSwatch key={c} color={c} active={shape.fill === c} onClick={() => e?.updateSelectedShapes({ fill: c })} label={`Заливка ${c}`} />
                ))}
                <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border" title="Свой цвет" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
                  <input type="color" value={shape.fill ?? '#ffffff'} onChange={(ev) => e?.updateSelectedShapes({ fill: ev.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Свой цвет заливки" />
                </label>
              </div>
            </div>
          )}
          <Slider label="Толщина обводки" min={0} max={16} step={0.5} value={shape.strokeWidth} onChange={(v) => e?.updateSelectedShapes({ strokeWidth: v })} />
          <Slider label="Непрозрачность" min={10} max={100} value={Math.round(shape.opacity * 100)} onChange={(v) => e?.updateSelectedShapes({ opacity: v / 100 })} format={(v) => `${v}%`} />
          {shape.kind === 'roundedRect' && <Slider label="Скругление углов" min={0} max={80} value={Math.round(shape.cornerRadius ?? 14)} onChange={(v) => e?.updateSelectedShapes({ cornerRadius: v })} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline text editor: a <textarea> laid exactly over the text element. Its position is updated
 * from the engine's frame callback directly on the DOM node, so panning/zooming while editing
 * does not re-render React.
 */
export function TextEditorOverlay() {
  const req = useEditor((s) => s.textEdit);
  const session = useSession();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [patch, setPatch] = useState<Partial<TextElement>>({});
  const committed = useRef(false);

  useEffect(() => {
    if (!req) return;
    committed.current = false;
    setText(req.element.text);
    setPatch({});
    requestAnimationFrame(() => areaRef.current?.focus());
  }, [req]);

  const el = req ? ({ ...req.element, ...patch } as TextElement) : null;

  useEffect(() => {
    const engine = session.engine;
    if (!engine || !el) return;
    const place = () => {
      const box = boxRef.current;
      const p = engine.pageToScreen(el.pageId, { x: el.x, y: el.y });
      if (!box || !p) return;
      const s = engine.viewport.scale;
      box.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${el.rotation}rad)`;
      box.style.width = `${el.width * s}px`;
      box.style.fontSize = `${el.fontSize * s}px`;
      box.style.padding = `${TEXT_PADDING * s}px`;
    };
    place();
    return engine.onFrame(place);
  }, [session.engine, el]);

  useLayoutEffect(() => {
    const a = areaRef.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${a.scrollHeight}px`;
  });

  if (!req || !el) return null;

  const commit = (cancel = false) => {
    if (committed.current) return;
    committed.current = true;
    session.engine?.commitTextEdit(cancel ? null : text, patch);
  };

  return (
    <>
      <div
        ref={boxRef}
        className="absolute left-0 top-0 z-20 origin-top-left rounded-[3px] outline outline-2 outline-primary/70"
        style={{ fontFamily: FONT_STACKS[el.fontFamily], lineHeight: LINE_HEIGHT }}
      >
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            // Keep editing while interacting with the formatting bar.
            if ((e.relatedTarget as HTMLElement | null)?.closest('[data-text-format]')) return;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              commit(req.isNew);
            }
            e.stopPropagation();
          }}
          placeholder="Текст"
          aria-label="Редактирование текста"
          spellCheck
          className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
          style={{ color: el.color, textAlign: el.align, font: 'inherit', lineHeight: 'inherit' }}
          rows={1}
        />
      </div>
      <div data-text-format className="glass absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border p-1 shadow-float">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              <Type className="h-4 w-4" /> Формат
            </Button>
          </PopoverTrigger>
          <PopoverContent data-text-format onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => { e.preventDefault(); areaRef.current?.focus(); }}>
            <TextOptions
              value={{ fontFamily: el.fontFamily, fontSize: el.fontSize, color: el.color, align: el.align }}
              onChange={(v) => setPatch((p) => ({ ...p, ...v }))}
            />
          </PopoverContent>
        </Popover>
        <Button size="sm" className="rounded-full" onMouseDown={(e) => e.preventDefault()} onClick={() => commit()}>
          <Check className="h-4 w-4" /> Готово
        </Button>
      </div>
    </>
  );
}

export function ZoomControls() {
  const view = useEditor((s) => s.view);
  const session = useSession();
  const [goTo, setGoTo] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <div className="glass pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+12px)] right-3 z-10 flex items-center gap-0.5 rounded-full border p-1 shadow-soft">
        <button className="h-9 rounded-full px-3 text-[13px] font-medium tabular-nums hover:bg-muted" onClick={() => (setValue(String(view.pageIndex + 1)), setGoTo(true))} aria-label="Перейти к странице" data-testid="page-indicator">
          {view.pageCount ? `${view.pageIndex + 1} / ${view.pageCount}` : '–'}
        </button>
        <span className="h-5 w-px bg-border" />
        <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" onClick={() => session.engine?.zoomBy(1 / 1.25)} aria-label="Уменьшить">
          <Minus className="h-4 w-4" />
        </button>
        <button className="h-9 min-w-[3.5rem] rounded-full text-[13px] font-medium tabular-nums hover:bg-muted" onClick={() => session.engine?.setZoom(1)} aria-label="Масштаб 100%" title="100%" data-testid="zoom-level">
          {Math.round(view.scale * 100)}%
        </button>
        <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" onClick={() => session.engine?.zoomBy(1.25)} aria-label="Увеличить">
          <Plus className="h-4 w-4" />
        </button>
        <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted" onClick={() => session.engine?.fitWidth()} aria-label="По ширине" title="По ширине">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <Dialog open={goTo} onOpenChange={setGoTo}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Перейти к странице</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(value, 10);
              if (n >= 1 && n <= view.pageCount) session.engine?.scrollToPage(n - 1);
              setGoTo(false);
            }}
            className="flex flex-col gap-4"
          >
            <Input type="number" inputMode="numeric" min={1} max={view.pageCount} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Номер страницы" />
            <DialogFooter>
              <Button type="submit">Перейти</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Performance HUD (Settings → developer, or Shift+P). Reads engine counters every 500 ms. */
export function PerfOverlay() {
  const show = useSettings((s) => s.showPerf);
  const session = useSession();
  const [, tick] = useState(0);
  const last = useRef({ events: 0, renders: 0, t: performance.now() });
  const [rates, setRates] = useState({ events: 0, renders: 0 });
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => {
      const p = session.engine?.perf;
      if (p) {
        const now = performance.now();
        const dt = (now - last.current.t) / 1000;
        setRates({ events: Math.round((p.inputEvents - last.current.events) / dt), renders: Math.round((p.bitmapRenders - last.current.renders) / dt) });
        last.current = { events: p.inputEvents, renders: p.bitmapRenders, t: now };
      }
      tick((n) => n + 1);
    }, 500);
    return () => clearInterval(id);
  }, [show, session]);
  const p = session.engine?.perf;
  if (!show || !p) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md bg-black/75 px-3 py-2 font-mono text-[11px] leading-relaxed text-white">
      <div>frame {p.frameMs.toFixed(1)} ms · overlay {p.overlayMs.toFixed(1)} ms</div>
      <div>input {rates.events}/s · bitmaps {rates.renders}/s · cached {p.cachedPages}</div>
      <div>state {session.engine?.gestureState} · zoom {Math.round((session.engine?.viewport.scale ?? 1) * 100)}%</div>
      <div>coalesced {p.coalesced ? 'yes' : 'no'} · predicted {p.predicted ? 'yes' : 'no'} · dpr {Math.min(devicePixelRatio, 2)}</div>
    </div>
  );
}

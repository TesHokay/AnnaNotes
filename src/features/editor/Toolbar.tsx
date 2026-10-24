import { memo, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpRight,
  Circle,
  Hexagon,
  Eraser,
  Highlighter,
  ImagePlus,
  Lasso,
  Minus,
  PenTool,
  Shapes,
  Sparkles,
  Square,
  SquareDashed,
  Triangle,
  Type,
} from 'lucide-react';
import { ColorSwatch, Label, Segmented, Slider, Switch } from '@/components/ui/controls';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import type { ToolKind } from '@/engine/tools';
import { FONT_LABELS } from '@/engine/text';
import { putAsset } from '@/db/repo';
import { useSession } from '@/editor/session';
import { pickFiles } from '@/lib/files';
import { prepareImage } from '@/lib/images';
import { cn } from '@/lib/utils';
import type { FontFamilyKey, ShapeElementKind, TextAlign } from '@/model/types';
import { PenOptions } from './PenOptions';
import { HIGHLIGHTER_COLORS, PEN_COLORS, SHAPE_FILLS, useSettings, type ToolSettings } from '@/store/settings';
import { errorMessage, toast } from '@/store/ui';

const TOOLS: { tool: ToolKind; icon: typeof PenTool; label: string; key: string }[] = [
  { tool: 'pen', icon: PenTool, label: 'Ручка', key: 'P' },
  { tool: 'highlighter', icon: Highlighter, label: 'Маркер', key: 'H' },
  { tool: 'eraser', icon: Eraser, label: 'Ластик', key: 'E' },
  { tool: 'lasso', icon: Lasso, label: 'Лассо', key: 'L' },
  { tool: 'shape', icon: Shapes, label: 'Фигуры', key: 'S' },
  { tool: 'text', icon: Type, label: 'Текст', key: 'T' },
];

const WIDTH_PRESETS: Partial<Record<ToolKind, number[]>> = {
  pen: [1.2, 2.2, 4],
  highlighter: [8, 14, 24],
  eraser: [12, 24, 48],
  shape: [1, 2, 4],
};

function currentColor(t: ToolSettings): string | null {
  switch (t.tool) {
    case 'pen':
      return t.pen.color;
    case 'highlighter':
      return t.highlighter.color;
    case 'shape':
      return t.shape.color;
    case 'text':
      return t.text.color;
    default:
      return null;
  }
}

function withColor(t: ToolSettings, color: string): ToolSettings {
  switch (t.tool) {
    case 'pen':
      return { ...t, pen: { ...t.pen, color } };
    case 'highlighter':
      return { ...t, highlighter: { ...t.highlighter, color } };
    case 'shape':
      return { ...t, shape: { ...t.shape, color } };
    case 'text':
      return { ...t, text: { ...t.text, color } };
    default:
      return t;
  }
}

function currentWidth(t: ToolSettings): number | null {
  if (t.tool === 'pen') return t.pen.width;
  if (t.tool === 'highlighter') return t.highlighter.width;
  if (t.tool === 'eraser') return t.eraser.size;
  if (t.tool === 'shape') return t.shape.width;
  return null;
}

function withWidth(t: ToolSettings, w: number): ToolSettings {
  if (t.tool === 'pen') return { ...t, pen: { ...t.pen, width: w } };
  if (t.tool === 'highlighter') return { ...t, highlighter: { ...t.highlighter, width: w } };
  if (t.tool === 'eraser') return { ...t, eraser: { ...t.eraser, size: w } };
  if (t.tool === 'shape') return { ...t, shape: { ...t.shape, width: w } };
  return t;
}

export const Toolbar = memo(function Toolbar({ compact }: { compact?: boolean }) {
  const tools = useSettings((s) => s.tools);
  const quickColors = useSettings((s) => s.quickPenColors);
  const update = useSettings((s) => s.updateTools);
  const session = useSession();
  const [optionsFor, setOptionsFor] = useState<ToolKind | null>(null);

  const select = (tool: ToolKind) => {
    if (tools.tool === tool) setOptionsFor(optionsFor === tool ? null : tool);
    else {
      setOptionsFor(null);
      update((t) => ({ ...t, tool }));
    }
  };

  const insertImage = async () => {
    const [file] = await pickFiles('image/png,image/jpeg,.png,.jpg,.jpeg');
    if (!file) return;
    try {
      const img = await prepareImage(file);
      const asset = await putAsset(img.blob, 'image', file.name, { width: img.width, height: img.height });
      update((t) => ({ ...t, tool: 'lasso' }));
      session.engine?.insertImage(asset.id, img.width, img.height);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  const color = currentColor(tools);
  const width = currentWidth(tools);
  const presets = WIDTH_PRESETS[tools.tool];
  const colors = tools.tool === 'highlighter' ? HIGHLIGHTER_COLORS.slice(0, 3) : quickColors;

  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto px-2 scrollbar-none', compact ? 'h-14 justify-between' : 'h-12 justify-center')} role="toolbar" aria-label="Инструменты">
      {TOOLS.map(({ tool, icon: Icon, label, key }) => (
        <Popover key={tool} open={optionsFor === tool} onOpenChange={(o) => !o && setOptionsFor(null)}>
          <PopoverAnchor asChild>
            <button
              onClick={() => select(tool)}
              aria-label={`${label} (${key})`}
              title={`${label} (${key}) — нажмите ещё раз для настроек`}
              aria-pressed={tools.tool === tool}
              data-testid={`tool-${tool}`}
              className={cn(
                'relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
                tools.tool === tool ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-muted',
              )}
            >
              <Icon className="h-[22px] w-[22px]" />
              {tools.tool === tool && color && <span className="absolute bottom-1 h-1 w-3 rounded-full" style={{ background: color }} />}
            </button>
          </PopoverAnchor>
          <PopoverContent className="w-80" onOpenAutoFocus={(e) => e.preventDefault()}>
            <ToolOptions tool={tool} />
          </PopoverContent>
        </Popover>
      ))}
      <button onClick={() => void insertImage()} aria-label="Вставить изображение" title="Вставить изображение" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-muted">
        <ImagePlus className="h-[22px] w-[22px]" />
      </button>

      {!compact && (color || presets) && <div className="mx-2 h-6 w-px shrink-0 bg-border" />}
      {!compact && color && (
        <div className="flex items-center gap-1.5">
          {colors.map((c) => (
            <ColorSwatch key={c} color={c} size={28} active={color === c} onClick={() => update((t) => withColor(t, c))} />
          ))}
        </div>
      )}
      {!compact && presets && width !== null && (
        <div className="ml-2 flex items-center gap-0.5">
          {presets.map((w, i) => (
            <button
              key={w}
              onClick={() => update((t) => withWidth(t, w))}
              aria-label={`Толщина ${i + 1}`}
              aria-pressed={Math.abs(width - w) < 0.01}
              className={cn('grid h-10 w-10 place-items-center rounded-full', Math.abs(width - w) < 0.01 ? 'bg-accent' : 'hover:bg-muted')}
            >
              <span className="rounded-full bg-foreground/80" style={{ width: 6 + i * 5, height: 6 + i * 5 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function ToolOptions({ tool }: { tool: ToolKind }) {
  const tools = useSettings((s) => s.tools);
  const update = useSettings((s) => s.updateTools);
  const session = useSession();

  const palette = (colors: string[], value: string, onPick: (c: string) => void) => (
    <div>
      <Label>Цвет</Label>
      <div className="grid grid-cols-7 gap-2">
        {colors.map((c) => (
          <ColorSwatch key={c} color={c} active={value.toLowerCase() === c.toLowerCase()} onClick={() => onPick(c)} />
        ))}
        <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border" title="Свой цвет" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
          <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Свой цвет" />
        </label>
      </div>
    </div>
  );


  switch (tool) {
    case 'pen':
      return <PenOptions />;
    case 'highlighter':
      return (
        <div className="flex flex-col gap-4">
          {palette(HIGHLIGHTER_COLORS, tools.highlighter.color, (color) => update((t) => ({ ...t, highlighter: { ...t.highlighter, color } })))}
          <Slider label="Толщина" min={4} max={40} value={tools.highlighter.width} onChange={(width) => update((t) => ({ ...t, highlighter: { ...t.highlighter, width } }))} />
          <Slider label="Прозрачность" min={15} max={70} value={Math.round(tools.highlighter.opacity * 100)} onChange={(v) => update((t) => ({ ...t, highlighter: { ...t.highlighter, opacity: v / 100 } }))} format={(v) => `${v}%`} />
          <Switch checked={tools.highlighter.snapToText} onChange={(snapToText) => update((t) => ({ ...t, highlighter: { ...t.highlighter, snapToText } }))} label="Выравнивать по тексту PDF" description="Маркер ложится ровно на строки текста" />
        </div>
      );
    case 'eraser':
      return (
        <div className="flex flex-col gap-4">
          <Segmented<'partial' | 'stroke' | 'object'>
            value={tools.eraser.mode}
            onChange={(mode) => update((t) => ({ ...t, eraser: { ...t.eraser, mode } }))}
            options={[
              { value: 'partial', label: 'Точный' },
              { value: 'stroke', label: 'Штрих' },
              { value: 'object', label: 'Объект' },
            ]}
          />
          <p className="text-[12px] text-muted-foreground">
            {tools.eraser.mode === 'partial' ? 'Стирает только участок под ластиком.' : tools.eraser.mode === 'stroke' ? 'Удаляет линию целиком.' : 'Удаляет фигуры, текст и изображения целиком.'}
          </p>
          <Slider label="Размер" min={8} max={96} value={tools.eraser.size} onChange={(size) => update((t) => ({ ...t, eraser: { ...t.eraser, size } }))} />
          <Button
            variant="secondary"
            onClick={() => {
              session.engine?.selectAll();
              session.engine?.deleteSelection();
            }}
          >
            Очистить текущую страницу
          </Button>
        </div>
      );
    case 'lasso':
      return (
        <div className="flex flex-col gap-3">
          <Segmented<'free' | 'rect'>
            value={tools.lasso.mode}
            onChange={(mode) => update((t) => ({ ...t, lasso: { mode } }))}
            options={[
              { value: 'free', label: <><Lasso className="h-4 w-4" /> Свободное</> },
              { value: 'rect', label: <><SquareDashed className="h-4 w-4" /> Прямоугольник</> },
            ]}
          />
          <p className="text-[12px] text-muted-foreground">Коснитесь объекта, чтобы выбрать его. Тяните за углы — масштаб, за верхнюю точку — поворот.</p>
        </div>
      );
    case 'shape': {
      const kinds: { k: ShapeElementKind | 'auto'; icon: React.ReactNode; label: string }[] = [
        { k: 'auto', icon: <Sparkles className="h-5 w-5" />, label: 'Авто' },
        { k: 'line', icon: <Minus className="h-5 w-5" />, label: 'Линия' },
        { k: 'arrow', icon: <ArrowUpRight className="h-5 w-5" />, label: 'Стрелка' },
        { k: 'rectangle', icon: <Square className="h-5 w-5" />, label: 'Прямоуг.' },
        { k: 'roundedRect', icon: <Square className="h-5 w-5 rounded-md" strokeWidth={2.5} />, label: 'Скругл.' },
        { k: 'ellipse', icon: <Circle className="h-5 w-5" />, label: 'Эллипс' },
        { k: 'triangle', icon: <Triangle className="h-5 w-5" />, label: 'Треуг.' },
        { k: 'polygon', icon: <Hexagon className="h-5 w-5" />, label: 'Многоуг.' },
      ];
      const sh = tools.shape;
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-1.5">
            {kinds.map(({ k, icon, label }) => (
              <button
                key={k}
                onClick={() => update((t) => ({ ...t, shape: { ...t.shape, kind: k } }))}
                aria-pressed={sh.kind === k}
                className={cn('flex flex-col items-center gap-1 rounded-md py-2 text-[11px]', sh.kind === k ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          {palette(PEN_COLORS, sh.color, (color) => update((t) => ({ ...t, shape: { ...t.shape, color } })))}
          <div>
            <Label>Заливка</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => update((t) => ({ ...t, shape: { ...t.shape, fill: null } }))}
                aria-pressed={sh.fill === null}
                className={cn('h-8 rounded-full border px-3 text-[12px]', sh.fill === null && 'border-primary bg-accent text-accent-foreground')}
              >
                Без заливки
              </button>
              {SHAPE_FILLS.map((c) => (
                <ColorSwatch key={c} color={c} active={sh.fill === c} onClick={() => update((t) => ({ ...t, shape: { ...t.shape, fill: c } }))} />
              ))}
            </div>
          </div>
          <Slider label="Толщина обводки" min={0} max={12} step={0.5} value={sh.width} onChange={(width) => update((t) => ({ ...t, shape: { ...t.shape, width } }))} />
          <Slider label="Непрозрачность" min={10} max={100} value={Math.round(sh.opacity * 100)} onChange={(v) => update((t) => ({ ...t, shape: { ...t.shape, opacity: v / 100 } }))} format={(v) => `${v}%`} />
          <p className="text-[12px] text-muted-foreground">После рисования фигура выделяется: тяните ручки, чтобы изменить ширину, высоту или повернуть. Shift — ровные пропорции и углы 45°.</p>
        </div>
      );
    }
    case 'text':
      return <TextOptions value={tools.text} onChange={(text) => update((t) => ({ ...t, text: { ...t.text, ...text } }))} />;
  }
}

export function TextOptions({ value, onChange }: { value: ToolSettings['text']; onChange: (v: Partial<ToolSettings['text']>) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Шрифт</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(FONT_LABELS) as FontFamilyKey[]).map((f) => (
            <button key={f} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange({ fontFamily: f })} aria-pressed={value.fontFamily === f} className={cn('min-h-10 rounded-md px-2 text-[14px]', value.fontFamily === f ? 'bg-accent text-accent-foreground' : 'bg-muted/60 hover:bg-muted')}>
              {FONT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      <Slider label="Размер" min={8} max={72} value={value.fontSize} onChange={(fontSize) => onChange({ fontSize })} format={(v) => `${v} pt`} />
      <div>
        <Label>Цвет</Label>
        <div className="flex flex-wrap gap-2">
          {PEN_COLORS.slice(0, 7).map((c) => (
            <ColorSwatch key={c} color={c} active={value.color === c} onClick={() => onChange({ color: c })} />
          ))}
        </div>
      </div>
      <Segmented<TextAlign>
        value={value.align}
        onChange={(align) => onChange({ align })}
        options={[
          { value: 'left', label: <AlignLeft className="h-4 w-4" />, title: 'По левому краю' },
          { value: 'center', label: <AlignCenter className="h-4 w-4" />, title: 'По центру' },
          { value: 'right', label: <AlignRight className="h-4 w-4" />, title: 'По правому краю' },
        ]}
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Folder as FolderIcon, FolderOpen, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ColorSwatch, Input, Label, Segmented, Slider, Switch } from '@/components/ui/controls';
import { COVER_COLORS, DEFAULT_SETUP, PAPER_COLORS, pageDimensions } from '@/model/paper';
import { CUTE_BY_ID, CUTE_PAPERS, LINE_COLORS, resolveRuling, SPACING_RANGE } from '@/model/cutePaper';
import type { Folder, Orientation, PageSetup, PageTemplate, PaperSize, PaperStyle, UUID } from '@/model/types';
import { cn } from '@/lib/utils';
import { TemplatePreview } from './TemplatePreview';

export function NameDialog({
  open,
  title,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (v: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="flex flex-col gap-4"
        >
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} aria-label={title} onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CLASSIC: { t: PageTemplate; label: string }[] = [
  { t: 'blank', label: 'Пустой' },
  { t: 'lined', label: 'Линейка' },
  { t: 'grid', label: 'Клетка' },
  { t: 'dotted', label: 'Точки' },
];

export function PageSetupFields({ value, onChange }: { value: PageSetup; onChange: (v: PageSetup) => void }) {
  const landscape = value.orientation === 'landscape';
  const cute = value.style?.cute ? CUTE_BY_ID[value.style.cute] : null;
  const ruling = resolveRuling({ ...pageDimensions(value.size, value.orientation), ...value });
  const setStyle = (patch: Partial<PaperStyle>) => {
    const next = { ...value.style, ...patch };
    for (const k of Object.keys(next) as (keyof PaperStyle)[]) if (next[k] === undefined) delete next[k];
    onChange({ ...value, style: Object.keys(next).length ? next : undefined });
  };
  const hasLines = value.template !== 'blank' || cute?.decor === 'gingham';
  const tile = (active: boolean) => cn('flex min-w-0 flex-col items-center gap-1.5 rounded-md p-1.5 text-center text-[12px] leading-tight transition-colors [overflow-wrap:anywhere]', active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Шаблон</Label>
        <div className="grid grid-cols-4 gap-2">
          {CLASSIC.map(({ t, label }) => (
            <button key={t} type="button" onClick={() => onChange({ ...value, template: t, style: undefined })} aria-pressed={!cute && value.template === t} className={tile(!cute && value.template === t)}>
              <TemplatePreview template={t} paperColor={cute ? '#ffffff' : value.paperColor} landscape={landscape} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Cute Paper</Label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2" data-testid="cute-paper">
          {CUTE_PAPERS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.description}
              onClick={() => onChange({ ...value, template: c.template, paperColor: c.paperColor, style: { cute: c.id } })}
              aria-pressed={cute?.id === c.id}
              className={tile(cute?.id === c.id)}
            >
              <TemplatePreview template={c.template} paperColor={c.paperColor} style={{ cute: c.id }} landscape={landscape} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Формат</Label>
          <Segmented<PaperSize>
            value={value.size}
            onChange={(size) => onChange({ ...value, size })}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A5', label: 'A5' },
              { value: 'Letter', label: 'Letter' },
            ]}
          />
        </div>
        <div>
          <Label>Ориентация</Label>
          <Segmented<Orientation>
            value={value.orientation}
            onChange={(orientation) => onChange({ ...value, orientation })}
            options={[
              { value: 'portrait', label: 'Книжная' },
              { value: 'landscape', label: 'Альбомная' },
            ]}
          />
        </div>
      </div>
      <div>
        <Label>Цвет бумаги</Label>
        <div className="flex flex-wrap items-center gap-2.5">
          {PAPER_COLORS.map((c) => (
            <ColorSwatch key={c.value} color={c.value} label={c.label} active={value.paperColor === c.value} onClick={() => onChange({ ...value, paperColor: c.value })} />
          ))}
          {cute && <ColorSwatch color={cute.paperColor} label={`Цвет ${cute.name}`} active={value.paperColor === cute.paperColor} onClick={() => onChange({ ...value, paperColor: cute.paperColor })} />}
          <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border" title="Свой цвет" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
            <input type="color" value={value.paperColor} onChange={(e) => onChange({ ...value, paperColor: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Свой цвет бумаги" />
          </label>
        </div>
      </div>
      {hasLines && (
        <div className="flex gap-4 rounded-md bg-muted/50 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Slider
              label={value.template === 'lined' ? 'Расстояние между линиями' : value.template === 'dotted' ? 'Шаг точек' : 'Размер клетки'}
              min={SPACING_RANGE.min}
              max={SPACING_RANGE.max}
              value={Math.round(ruling.spacing)}
              onChange={(spacing) => setStyle({ spacing })}
              format={(v) => `${(v * 0.3528).toFixed(1)} мм`}
            />
            <div>
              <Label>Цвет линий</Label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setStyle({ lineColor: undefined })} aria-pressed={!value.style?.lineColor} className={cn('h-8 rounded-full border px-3 text-[12px]', !value.style?.lineColor && 'border-primary bg-accent text-accent-foreground')}>
                  Обычный
                </button>
                {LINE_COLORS.map((c) => (
                  <ColorSwatch key={c} color={c} size={28} active={value.style?.lineColor === c} onClick={() => setStyle({ lineColor: c })} label={`Линии ${c}`} />
                ))}
              </div>
            </div>
            {cute && cute.decor !== 'none' && cute.decor !== 'gingham' && (
              <Switch checked={value.style?.decor !== false} onChange={(v) => setStyle({ decor: v ? undefined : false })} label="Декоративные детали" description={cute.decor === 'sakura' ? 'Цветы сакуры по уголкам' : 'Сердечки вдоль краёв'} />
            )}
          </div>
          <div className="hidden shrink-0 flex-col items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <TemplatePreview template={value.template} paperColor={value.paperColor} style={value.style} landscape={landscape} width={landscape ? 96 : 72} />
            Предпросмотр
          </div>
        </div>
      )}
    </div>
  );
}

export function NewNotebookDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (v: { title: string; coverColor: string; setup: PageSetup }) => void }) {
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState(COVER_COLORS[0]!);
  const [setup, setSetup] = useState<PageSetup>(DEFAULT_SETUP);
  useEffect(() => {
    if (open) {
      setTitle('');
      setCover(COVER_COLORS[Math.floor(Math.random() * 8)]!);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Новая тетрадь</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate({ title: title.trim() || 'Новая тетрадь', coverColor: cover, setup });
          }}
        >
          <div>
            <Label>Название</Label>
            <Input autoFocus placeholder="Новая тетрадь" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label>Обложка</Label>
            <div className="flex flex-wrap gap-2.5">
              {COVER_COLORS.map((c) => (
                <ColorSwatch key={c} color={c} active={cover === c} onClick={() => setCover(c)} />
              ))}
            </div>
          </div>
          <PageSetupFields value={setup} onChange={setSetup} />
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">Создать</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Folder picker; `exclude` hides a folder subtree (can't move a folder into itself). */
export function MoveDialog({ open, folders, exclude, onClose, onMove }: { open: boolean; folders: Folder[]; exclude?: UUID; onClose: () => void; onMove: (folderId: UUID | null) => void }) {
  const [target, setTarget] = useState<UUID | null>(null);
  const children = (parent: UUID | null) => folders.filter((f) => f.parentId === parent && f.id !== exclude).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const renderTree = (parent: UUID | null, depth: number): React.ReactNode =>
    children(parent).map((f) => (
      <div key={f.id}>
        <button
          type="button"
          onClick={() => setTarget(f.id)}
          className={cn('flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-[15px]', target === f.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          {target === f.id ? <FolderOpen className="h-5 w-5 text-primary" /> : <FolderIcon className="h-5 w-5 text-primary" />}
          <span className="truncate">{f.name}</span>
        </button>
        {renderTree(f.id, depth + 1)}
      </div>
    ));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Переместить в папку</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50dvh] overflow-y-auto">
          <button
            type="button"
            onClick={() => setTarget(null)}
            className={cn('flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-[15px]', target === null ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
          >
            <Home className="h-5 w-5 text-muted-foreground" /> Без папки
          </button>
          {renderTree(null, 1)}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => onMove(target)}>Переместить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

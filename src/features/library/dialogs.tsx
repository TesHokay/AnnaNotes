import { useEffect, useState } from 'react';
import { Folder as FolderIcon, FolderOpen, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ColorSwatch, Input, Label, Segmented } from '@/components/ui/controls';
import { COVER_COLORS, DEFAULT_SETUP, PAPER_COLORS } from '@/model/paper';
import type { Folder, Orientation, PageSetup, PageTemplate, PaperSize, UUID } from '@/model/types';
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

export function PageSetupFields({ value, onChange }: { value: PageSetup; onChange: (v: PageSetup) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Шаблон</Label>
        <div className="grid grid-cols-4 gap-2">
          {(['blank', 'lined', 'grid', 'dotted'] as PageTemplate[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ ...value, template: t })}
              aria-pressed={value.template === t}
              className={cn('flex flex-col items-center gap-1.5 rounded-md p-1.5 text-[12px] transition-colors', value.template === t ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
            >
              <TemplatePreview template={t} paperColor={value.paperColor} landscape={value.orientation === 'landscape'} />
              {{ blank: 'Пустой', lined: 'Линейка', grid: 'Клетка', dotted: 'Точки' }[t]}
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
          <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border" title="Свой цвет" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
            <input type="color" value={value.paperColor} onChange={(e) => onChange({ ...value, paperColor: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Свой цвет бумаги" />
          </label>
        </div>
      </div>
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

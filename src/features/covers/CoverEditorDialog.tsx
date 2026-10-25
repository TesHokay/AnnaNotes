import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorSwatch, Input, Label, Segmented, Slider, Switch } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCover, removeCover, saveCover } from '@/db/repo';
import { pickFiles } from '@/lib/files';
import { canvasToBlob, decodeImage, downscaleImage } from '@/lib/images';
import { cn } from '@/lib/utils';
import type { CoverDecor, CoverDesign, CoverFont, Notebook } from '@/model/types';
import { errorMessage, toast } from '@/store/ui';
import { COVER_COLLECTIONS, COVER_DECOR, COVER_FONTS, COVER_PATTERNS, COVER_PRESETS, COVER_SWATCHES, designFromColor, designFromPreset, drawCover, TEXT_SWATCHES, type CoverPhoto } from './coverArt';

type Photo = CoverPhoto & { close(): void };

function useCanvasDraw(ref: React.RefObject<HTMLCanvasElement | null>, design: CoverDesign, photo: Photo | null, width: number) {
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = Math.round((width * 4) / 3);
    c.width = Math.round(width * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    drawCover(ctx, design, width, h, photo ?? null);
  }, [ref, design, photo, width]);
}

function PresetThumb({ design, title }: { design: CoverDesign; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(ref, { ...design, title }, null, 54);
  return <canvas ref={ref} className="h-[72px] w-[54px] rounded-l-[3px] rounded-r-[6px] shadow-soft" aria-hidden />;
}

/** Renders the library thumbnail (300×400 JPEG). */
export async function renderCoverThumb(design: CoverDesign, photo: Photo | null): Promise<Blob | undefined> {
  try {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 400;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    drawCover(ctx, design, 300, 400, photo ?? null);
    const blob = await canvasToBlob(c, 'image/jpeg', 0.86);
    c.width = c.height = 0;
    return blob;
  } catch {
    return undefined;
  }
}

/**
 * Cover editor: presets from seven collections, title, font, colours, pattern, decorations and
 * an optional photo — with a live preview. Saving touches only the cover, never the pages.
 */
export function CoverEditorDialog({ notebook, open, onClose }: { notebook: Notebook; open: boolean; onClose: () => void }) {
  const [design, setDesign] = useState<CoverDesign>(() => designFromColor(notebook.coverColor, notebook.title));
  const [collection, setCollection] = useState(COVER_COLLECTIONS[0]!);
  const [photo, setPhoto] = useState<Photo | null>(null);
  /** undefined = keep stored photo, Blob = new, null = removed */
  const [photoChange, setPhotoChange] = useState<Blob | null | undefined>(undefined);
  const [hasStored, setHasStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [previewW, setPreviewW] = useState(220);

  useEffect(() => {
    if (!open) return;
    setPreviewW(window.innerWidth < 640 ? 150 : 220);
    let cancelled = false;
    let decoded: Photo | null = null;
    setPhotoChange(undefined);
    setPhoto(null);
    void (async () => {
      const rec = await getCover(notebook.id).catch(() => undefined);
      if (cancelled) return;
      setDesign(rec ? { ...rec.design } : designFromColor(notebook.coverColor, notebook.title));
      setHasStored(!!rec?.photo);
      if (rec?.photo) {
        decoded = await decodeImage(rec.photo).catch(() => null);
        if (!cancelled) setPhoto(decoded);
      }
      if (rec?.design.preset) setCollection(COVER_PRESETS.find((p) => p.id === rec.design.preset)?.collection ?? COVER_COLLECTIONS[0]!);
    })();
    return () => {
      cancelled = true;
      decoded?.close();
    };
  }, [open, notebook.id, notebook.coverColor, notebook.title]);

  useCanvasDraw(previewRef, design, photo, previewW);

  const set = (patch: Partial<CoverDesign>) => setDesign((d) => ({ ...d, ...patch }));
  const toggleDecor = (id: CoverDecor) => set({ decor: design.decor.includes(id) ? design.decor.filter((x) => x !== id) : [...design.decor, id] });

  const choosePhoto = async () => {
    const [file] = await pickFiles('image/*');
    if (!file) return;
    try {
      const img = await downscaleImage(file, 1400);
      const decoded = await decodeImage(img.blob);
      photo?.close();
      setPhoto(decoded);
      setPhotoChange(img.blob);
      set({ photo: design.photo ?? { scale: 1, x: 0, y: 0, area: 'window' } });
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  const dropPhoto = () => {
    photo?.close();
    setPhoto(null);
    setPhotoChange(hasStored ? null : undefined);
    set({ photo: undefined });
  };

  const save = async () => {
    setBusy(true);
    try {
      const d = { ...design, title: design.title.trim() || notebook.title };
      const thumb = await renderCoverThumb(d, photo);
      await saveCover(notebook.id, d, photoChange, thumb);
      toast('Обложка сохранена', { kind: 'success' });
      onClose();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    try {
      await removeCover(notebook.id);
      toast('Восстановлена обычная обложка');
      onClose();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  // Drag the photo inside the preview.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!design.photo || !photo) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: design.photo.x, py: design.photo.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !design.photo) return;
    const k = 2.4 / previewW;
    set({ photo: { ...design.photo, x: Math.max(-1, Math.min(1, d.px + (e.clientX - d.x) * k)), y: Math.max(-1, Math.min(1, d.py + (e.clientY - d.y) * k)) } });
  };

  const chip = (active: boolean) => cn('min-h-9 rounded-full border px-3 py-1 text-[13px] leading-tight transition-colors', active ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted');
  const custom = (value: string, onPick: (c: string) => void, label: string) => (
    <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border" title={label} style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
      <input type="color" value={value} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={label} />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Обложка тетради</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2 sm:sticky sm:top-0 sm:self-start">
            <canvas
              ref={previewRef}
              style={{ width: previewW, height: (previewW * 4) / 3, touchAction: design.photo ? 'none' : 'auto' }}
              className={cn('rounded-l-[6px] rounded-r-[12px] shadow-float', design.photo && photo && 'cursor-grab active:cursor-grabbing')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              role="img"
              aria-label="Предпросмотр обложки"
              data-testid="cover-preview"
            />
            {design.photo && photo && <p className="max-w-[220px] text-center text-[12px] text-muted-foreground">Перетащите фото на обложке, чтобы сдвинуть его</p>}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div>
              <Label>Коллекции</Label>
              <div className="flex flex-wrap gap-1.5">
                {COVER_COLLECTIONS.map((c) => (
                  <button key={c} type="button" className={chip(collection === c)} onClick={() => setCollection(c)} aria-pressed={collection === c}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-2">
                {COVER_PRESETS.filter((p) => p.collection === collection).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDesign((d) => ({ ...designFromPreset(p, d.title), photo: d.photo }))}
                    aria-pressed={design.preset === p.id}
                    className={cn('flex min-w-0 flex-col items-center gap-1 rounded-md p-1.5 text-center text-[11px] leading-tight [overflow-wrap:anywhere]', design.preset === p.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
                  >
                    <PresetThumb design={designFromPreset(p, '')} title={design.title.slice(0, 18)} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Название</Label>
              <Input value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} placeholder={notebook.title} aria-label="Название на обложке" />
            </div>

            <div>
              <Label>Шрифт</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {(Object.keys(COVER_FONTS) as CoverFont[]).map((f) => (
                  <button key={f} type="button" onClick={() => set({ font: f })} aria-pressed={design.font === f} className={cn('min-h-10 rounded-md px-2 text-[15px] leading-tight', design.font === f ? 'bg-accent text-accent-foreground' : 'bg-muted/60 hover:bg-muted')} style={{ fontFamily: COVER_FONTS[f].stack }}>
                    {COVER_FONTS[f].label}
                  </button>
                ))}
              </div>
            </div>

            <Slider label="Размер текста" min={5} max={16} step={0.5} value={Math.round(design.fontSize * 200) / 2} onChange={(v) => set({ fontSize: v / 100 })} format={(v) => `${v}`} />
            <div>
              <Label>Цвет текста</Label>
              <div className="flex flex-wrap items-center gap-2">
                {TEXT_SWATCHES.map((c) => (
                  <ColorSwatch key={c} color={c} size={30} active={design.textColor === c} onClick={() => set({ textColor: c })} />
                ))}
                {custom(design.textColor, (c) => set({ textColor: c }), 'Свой цвет текста')}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Выравнивание</Label>
                <Segmented<'left' | 'center' | 'right'>
                  value={design.align}
                  onChange={(align) => set({ align })}
                  options={[
                    { value: 'left', label: 'Слева' },
                    { value: 'center', label: 'По центру' },
                    { value: 'right', label: 'Справа' },
                  ]}
                />
              </div>
              <Slider label="Положение по высоте" min={8} max={92} value={Math.round(design.textY * 100)} onChange={(v) => set({ textY: v / 100 })} format={(v) => `${v}%`} />
            </div>
            <Switch checked={design.label} onChange={(label) => set({ label })} label="Табличка под названием" />

            <div>
              <Label>Фон</Label>
              <div className="flex flex-wrap items-center gap-2">
                {COVER_SWATCHES.map((c) => (
                  <ColorSwatch key={c} color={c} size={30} active={design.background === c} onClick={() => set({ background: c })} />
                ))}
                {custom(design.background, (c) => set({ background: c }), 'Свой цвет фона')}
              </div>
            </div>

            <div>
              <Label>Узор</Label>
              <div className="flex flex-wrap gap-1.5">
                {COVER_PATTERNS.map((p) => (
                  <button key={p.id} type="button" className={chip(design.pattern === p.id)} onClick={() => set({ pattern: p.id })} aria-pressed={design.pattern === p.id}>
                    {p.label}
                  </button>
                ))}
              </div>
              {design.pattern !== 'none' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {['#ffffff', '#f6cad8', '#dfa3b7', '#d7c8f0', '#c4d8be', '#80666d', '#d9bf7f'].map((c) => (
                    <ColorSwatch key={c} color={c} size={28} active={design.patternColor === c} onClick={() => set({ patternColor: c })} label={`Узор ${c}`} />
                  ))}
                  {custom(design.patternColor, (c) => set({ patternColor: c }), 'Свой цвет узора')}
                </div>
              )}
            </div>

            <div>
              <Label>Украшения</Label>
              <div className="flex flex-wrap gap-1.5">
                {COVER_DECOR.map((d) => (
                  <button key={d.id} type="button" className={chip(design.decor.includes(d.id))} onClick={() => toggleDecor(d.id)} aria-pressed={design.decor.includes(d.id)}>
                    {d.label}
                  </button>
                ))}
              </div>
              {design.decor.some((d) => d !== 'flower' && d !== 'gold') && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {['#c9a45c', '#dfa3b7', '#f6cad8', '#fff9f2', '#80666d', '#c9d3f0'].map((c) => (
                    <ColorSwatch key={c} color={c} size={28} active={design.accent === c} onClick={() => set({ accent: c })} label={`Акцент ${c}`} />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void choosePhoto()}>
                  <ImagePlus className="h-4 w-4" /> {photo ? 'Другое фото' : 'Загрузить фото'}
                </Button>
                {photo && (
                  <Button variant="ghost" size="sm" onClick={dropPhoto}>
                    <Trash2 className="h-4 w-4" /> Убрать фото
                  </Button>
                )}
              </div>
              {design.photo && photo && (
                <>
                  <Segmented<'window' | 'full'>
                    value={design.photo.area}
                    onChange={(area) => set({ photo: { ...design.photo!, area } })}
                    options={[
                      { value: 'window', label: 'В окошке' },
                      { value: 'full', label: 'На всю обложку' },
                    ]}
                  />
                  <Slider label="Масштаб фото" min={100} max={300} value={Math.round(design.photo.scale * 100)} onChange={(v) => set({ photo: { ...design.photo!, scale: v / 100 } })} format={(v) => `${v}%`} />
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void reset()}>
            Обычная обложка
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy} data-testid="cover-save">
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAsset, putAsset } from '@/db/repo';
import { useSession } from '@/editor/session';
import { cropImageBlob, dragCrop, FULL_CROP, type CropHandle, type CropRect } from '@/lib/imageCrop';
import { prepareImage, type PreparedImage } from '@/lib/images';
import { useEditor } from '@/store/editor';
import { useSettings } from '@/store/settings';
import { errorMessage, toast } from '@/store/ui';

const HANDLES: { handle: Exclude<CropHandle, 'move'>; label: string; x: string; y: string }[] = [
  { handle: 'nw', label: 'Верхний левый угол', x: '0%', y: '0%' },
  { handle: 'ne', label: 'Верхний правый угол', x: '100%', y: '0%' },
  { handle: 'sw', label: 'Нижний левый угол', x: '0%', y: '100%' },
  { handle: 'se', label: 'Нижний правый угол', x: '100%', y: '100%' },
];

export function ImageCropDialog() {
  const request = useEditor((s) => s.imageEdit);
  return request ? <CropEditor request={request} /> : null;
}

function CropEditor({ request }: { request: NonNullable<ReturnType<typeof useEditor.getState>['imageEdit']> }) {
  const session = useSession();
  const [image, setImage] = useState<(PreparedImage & { url: string; name: string }) | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; handle: CropHandle; x: number; y: number; crop: CropRect } | null>(null);
  const editing = 'element' in request;
  const close = () => useEditor.setState({ imageEdit: null });

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setImage(null);
    setCrop(FULL_CROP);
    void (async () => {
      const asset = 'element' in request ? await getAsset(request.element.assetId) : null;
      const file = 'file' in request ? request.file : asset?.blob;
      if (!file) throw new Error('Фотография не найдена');
      const prepared = await prepareImage(file);
      if (cancelled) return;
      url = URL.createObjectURL(prepared.blob);
      setImage({ ...prepared, url, name: 'file' in request ? request.file.name : asset!.name });
    })().catch((err) => {
      if (!cancelled) { toast(errorMessage(err), { kind: 'error' }); close(); }
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [request]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as CropHandle | undefined;
    if (!handle) return;
    event.preventDefault();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, crop };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (!start || start.id !== event.pointerId || !bounds?.width || !bounds.height) return;
    setCrop(dragCrop(start.crop, start.handle, (event.clientX - start.x) / bounds.width, (event.clientY - start.y) / bounds.height));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    if (event.type === 'pointercancel') setCrop(drag.current.crop);
    drag.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
  };

  const save = async () => {
    if (!image || busy || !session.engine) return;
    setBusy(true);
    try {
      const result = await cropImageBlob(image, crop);
      if (editing && result === image) { close(); return; }
      const asset = await putAsset(result.blob, 'image', image.name, { width: result.width, height: result.height });
      if (editing) {
        if (!session.engine?.cropImage(request.element, asset.id, crop)) throw new Error('Фото изменилось. Выделите его и повторите обрезку.');
      } else {
        useSettings.getState().updateTools((t) => ({ ...t, tool: 'lasso' }));
        session.engine?.insertImage(asset.id, result.width, result.height);
      }
      close();
    } catch (err) { toast(errorMessage(err), { kind: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
      <DialogContent hideClose={busy} className="max-w-2xl" data-testid="image-crop-dialog">
        <DialogHeader><DialogTitle>{editing ? 'Обрезать фото' : 'Вставить фото'}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Потяните углы рамки, чтобы обрезать фото. Рамку можно перемещать.</p>
        {image ? <>
          <div ref={stage} className="relative mx-auto touch-none select-none overflow-hidden rounded-md bg-muted"
            style={{ width: 'min(100%, ' + (image.width / image.height * 45) + 'dvh)' }}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}
            data-testid="crop-stage">
            <img src={image.url} alt="Фото для обрезки" draggable={false} className="pointer-events-none block w-full" />
            <div data-crop-handle="move" className="absolute cursor-move border-2 border-white"
              style={{ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.width * 100 + '%', height: crop.height * 100 + '%', boxShadow: '0 0 0 9999px rgb(0 0 0 / 55%)' }}>
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">{Array.from({ length: 9 }, (_, i) => <span key={i} className="border border-white/25" />)}</div>
              {HANDLES.map(({ handle, label, x, y }) => <button key={handle} type="button" aria-label={label} data-crop-handle={handle} disabled={busy}
                className="absolute z-10 h-9 w-9 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-primary/80 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ left: x, top: y, cursor: handle + '-resize', transform: 'translate(' + (x === '0%' ? '0%' : '-100%') + ', ' + (y === '0%' ? '0%' : '-100%') + ')' }}
                onKeyDown={(event) => {
                  const dx = event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0;
                  const dy = event.key === 'ArrowUp' ? -0.01 : event.key === 'ArrowDown' ? 0.01 : 0;
                  if (dx || dy) { event.preventDefault(); setCrop((current) => dragCrop(current, handle, dx, dy)); }
                }} />)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span aria-live="polite">{Math.max(1, Math.round(image.width * crop.width))} × {Math.max(1, Math.round(image.height * crop.height))} пикс.</span>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCrop(FULL_CROP)}><RotateCcw className="h-4 w-4" /> Сбросить</Button>
          </div>
        </> : <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={close}>Отмена</Button>
          <Button disabled={!image || busy} onClick={() => void save()} data-testid="crop-save">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? 'Обрезать' : 'Вставить фото'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

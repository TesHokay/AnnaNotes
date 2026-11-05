import { Copy, CopyPlus, Crop, ImagePlus, Move, ClipboardPaste, Scissors, Scan, Trash2, Type } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { useSession } from '@/editor/session';
import { pickFiles } from '@/lib/files';
import { useEditor } from '@/store/editor';
import { useSettings } from '@/store/settings';

export function CanvasContextMenu() {
  const menu = useEditor((s) => s.contextMenu);
  const selection = useEditor((s) => s.selection);
  const session = useSession();
  const engine = session.engine;
  if (!menu || !engine) return null;
  const photo = selection?.image && !selection.image.sticker;
  const crop = () => {
    const element = engine.getSelectedImage();
    if (element) useEditor.setState({ imageEdit: { element } });
  };
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && useEditor.setState({ contextMenu: null })}>
      <DropdownMenuTrigger asChild>
        <button aria-label="Действия на странице" tabIndex={-1} className="pointer-events-none absolute h-px w-px opacity-0" style={{ left: menu.screen.x, top: menu.screen.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="canvas-context-menu">
        {selection ? <>
          <DropdownMenuItem onSelect={() => engine.copySelection()}><Copy /> Копировать</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => engine.cutSelection()}><Scissors /> Вырезать</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => engine.duplicateSelection()}><CopyPlus /> Дублировать</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useSettings.getState().updateTools((t) => ({ ...t, tool: 'lasso' }))}><Move /> Переместить</DropdownMenuItem>
          {photo && <DropdownMenuItem onSelect={crop}><Crop /> Обрезать фото</DropdownMenuItem>}
          {selection.hasText && selection.count === 1 && <DropdownMenuItem onSelect={() => engine.editSelectedText()}><Type /> Изменить текст</DropdownMenuItem>}
          <DropdownMenuItem destructive onSelect={() => engine.deleteSelection()}><Trash2 /> Удалить</DropdownMenuItem>
          <DropdownMenuSeparator />
        </> : <DropdownMenuItem onSelect={() => { engine.selectAll(menu.pageId); engine.copySelection(); }}><Copy /> Копировать содержимое страницы</DropdownMenuItem>}
        <DropdownMenuItem disabled={!engine.hasClipboard} onSelect={() => engine.paste(menu)}><ClipboardPaste /> Вставить</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => engine.selectAll(menu.pageId)}><Scan /> Выделить всё</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { void pickFiles('image/png,image/jpeg,.png,.jpg,.jpeg').then(([file]) => {
          if (file) useEditor.setState({ imageEdit: { file } });
        }); }}><ImagePlus /> Вставить фото…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

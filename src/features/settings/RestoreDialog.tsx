import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ParsedBackup } from '@/backup/backup';
import { applyBackup } from '@/features/actions';
import { errorMessage, toast } from '@/store/ui';
import { formatDate } from '@/lib/utils';

/** Restore flow: "add as copies" is the safe default; replacing the library needs a second explicit confirmation. */
export function RestoreDialog({ parsed, onClose }: { parsed: ParsedBackup | null; onClose: () => void }) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = parsed?.manifest;

  const run = async (mode: 'merge' | 'replace') => {
    if (!parsed) return;
    setBusy(true);
    try {
      await applyBackup(parsed, mode);
      onClose();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
      setConfirmReplace(false);
    }
  };

  return (
    <Dialog open={!!parsed} onOpenChange={(o) => !o && !busy && (setConfirmReplace(false), onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Восстановление из копии</DialogTitle>
          {m && (
            <DialogDescription>
              {m.scope === 'library' ? 'Копия библиотеки' : 'Копия документа'} от {formatDate(m.createdAt)}: документов — {m.notebooks.length}, страниц — {m.pages.length}.
            </DialogDescription>
          )}
        </DialogHeader>
        {confirmReplace ? (
          <div className="flex gap-3 rounded-md bg-destructive/10 p-3 text-[14px] text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Все текущие документы, папки и файлы на этом устройстве будут удалены и заменены содержимым копии. Это действие нельзя отменить.
          </div>
        ) : (
          <p className="text-[14px] text-muted-foreground">
            «Добавить» создаёт копии документов рядом с существующими — ничего не удаляется и не перезаписывается.
          </p>
        )}
        <DialogFooter>
          {confirmReplace ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmReplace(false)} disabled={busy}>
                Назад
              </Button>
              <Button variant="destructive" onClick={() => void run('replace')} disabled={busy}>
                Удалить текущее и восстановить
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmReplace(true)} disabled={busy}>
                Заменить библиотеку…
              </Button>
              <Button onClick={() => void run('merge')} disabled={busy}>
                {busy ? 'Восстановление…' : 'Добавить'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

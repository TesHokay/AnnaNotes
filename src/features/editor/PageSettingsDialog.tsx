import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/controls';
import { PageSetupFields } from '@/features/library/dialogs';
import { useSession } from '@/editor/session';
import { DEFAULT_SETUP } from '@/model/paper';
import type { Page, PageSetup } from '@/model/types';
import { useEditor } from '@/store/editor';
import { errorMessage, toast } from '@/store/ui';
import { updateNotebook } from '@/db/repo';

function setupOf(page: Page | undefined, fallback: PageSetup): PageSetup {
  if (!page) return fallback;
  return {
    size: page.size === 'custom' ? fallback.size : page.size,
    orientation: page.width > page.height ? 'landscape' : 'portrait',
    template: page.template,
    paperColor: page.paperColor,
  };
}

export function PageSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const session = useSession();
  const pages = useEditor((s) => s.pages);
  const index = useEditor((s) => s.view.pageIndex);
  const page = pages[index];
  const [setup, setSetup] = useState<PageSetup>(DEFAULT_SETUP);
  const [scope, setScope] = useState<'page' | 'all'>('page');

  useEffect(() => {
    if (open) setSetup(setupOf(page, session.notebook.defaultSetup));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = async () => {
    try {
      const ids = scope === 'all' ? pages.map((p) => p.id) : page ? [page.id] : [];
      await session.applySetup(ids, setup, pages);
      if (scope === 'all') await updateNotebook(session.notebook.id, { defaultSetup: setup });
      onOpenChange(false);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Настройки страницы</DialogTitle>
          {page?.pdf && <DialogDescription>Размер страниц PDF задаётся исходным файлом; меняется только шаблон и цвет новых страниц.</DialogDescription>}
        </DialogHeader>
        <PageSetupFields value={setup} onChange={setSetup} />
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'page', label: `Текущая страница (${index + 1})` },
            { value: 'all', label: 'Все страницы' },
          ]}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void apply()}>Применить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useImport, type JobStatus } from './importQueue';

const ICON: Record<JobStatus, React.ReactNode> = {
  pending: <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />,
  working: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  done: <CheckCircle2 className="h-4 w-4 text-[#2f9e5b]" />,
  skipped: <CircleSlash className="h-4 w-4 text-muted-foreground" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
};

/** Progress of a bulk import: per-file status, overall bar, cancel. */
export function ImportDialog() {
  const { open, running, jobs, notice, cancelRequested, close, cancel } = useImport();
  const finished = jobs.filter((j) => j.status !== 'pending' && j.status !== 'working').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const errors = jobs.filter((j) => j.status === 'error').length;
  const skipped = jobs.filter((j) => j.status === 'skipped').length;
  const pct = jobs.length ? Math.round((finished / jobs.length) * 100) : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg" hideClose={running} onInteractOutside={(e) => running && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{running ? 'Импорт…' : 'Импорт завершён'}</DialogTitle>
          <DialogDescription>
            {jobs.length === 0 ? 'Подготовка файлов…' : `Готово ${finished} из ${jobs.length} · импортировано ${done}${skipped ? ` · пропущено ${skipped}` : ''}${errors ? ` · ошибок ${errors}` : ''}`}
          </DialogDescription>
        </DialogHeader>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        {notice && (
          <div className="flex gap-2 rounded-md bg-[#ff9500]/10 p-3 text-[13px] leading-snug text-[#b25f00] dark:text-[#ffb340]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{notice}</span>
          </div>
        )}
        <ul className="max-h-[45dvh] overflow-y-auto text-[14px]" data-testid="import-jobs">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-start gap-2.5 border-b py-2 last:border-0">
              <span className="mt-0.5 grid h-4 w-4 place-items-center">{ICON[j.status]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{j.name}</span>
                {(j.path.length > 0 || j.message) && (
                  <span className={`block truncate text-[12px] ${j.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {j.message ?? j.path.join(' / ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {running ? (
            <Button variant="secondary" onClick={cancel} disabled={cancelRequested}>
              {cancelRequested ? 'Останавливаем…' : 'Отменить'}
            </Button>
          ) : (
            <Button onClick={close}>Готово</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

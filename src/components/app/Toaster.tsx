import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUI, type Toast } from '@/store/ui';
import { cn } from '@/lib/utils';

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useUI((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t, dismiss]);
  const Icon = t.kind === 'error' ? AlertCircle : t.kind === 'success' ? CheckCircle2 : Info;
  return (
    <div role={t.kind === 'error' ? 'alert' : 'status'} className="glass pointer-events-auto flex max-w-md items-center gap-3 rounded-md border px-4 py-3 shadow-float animate-in fade-in-0 slide-in-from-bottom-2">
      <Icon className={cn('h-5 w-5 shrink-0', t.kind === 'error' ? 'text-destructive' : t.kind === 'success' ? 'text-[#34c759]' : 'text-primary')} />
      <span className="text-[14px] leading-snug">{t.message}</span>
      {t.action && (
        <button
          className="ml-1 shrink-0 text-[14px] font-semibold text-primary"
          onClick={() => {
            t.action!.run();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

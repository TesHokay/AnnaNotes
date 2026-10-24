import { CloudOff, HardDriveDownload, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';

/** Global, non-modal status messages: offline, storage full, update ready, local-data warning. */
export function StatusBanners({ compact = false }: { compact?: boolean }) {
  const online = useUI((s) => s.online);
  const save = useUI((s) => s.save);
  const updateAvailable = useUI((s) => s.updateAvailable);
  const applyUpdate = useUI((s) => s.applyUpdate);
  const persisted = useUI((s) => s.storagePersisted);
  const dismissed = useSettings((s) => s.storageNoticeDismissed);
  const setSetting = useSettings((s) => s.set);
  const [updating, setUpdating] = useState(false);

  const items: React.ReactNode[] = [];
  if (save.status === 'quota') {
    items.push(
      <Banner key="quota" tone="error" icon={<HardDriveDownload className="h-4 w-4" />}>
        Хранилище заполнено — последние изменения ещё не сохранены. Удалите ненужные документы или очистите корзину; сохранение повторится автоматически.
      </Banner>,
    );
  } else if (save.status === 'error') {
    items.push(
      <Banner key="err" tone="error" icon={<ShieldAlert className="h-4 w-4" />}>
        {save.error?.message ?? 'Ошибка сохранения'} — повторяем попытку…
      </Banner>,
    );
  }
  if (updateAvailable && applyUpdate) {
    items.push(
      <Banner key="upd" tone="info" icon={<RefreshCw className="h-4 w-4" />}>
        Доступна новая версия приложения. Документы не пострадают.
        <Button
          size="sm"
          className="ml-2 h-8"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            void applyUpdate().finally(() => setUpdating(false));
          }}
        >
          {updating ? 'Сохраняем…' : 'Обновить'}
        </Button>
      </Banner>,
    );
  }
  if (!online && !compact) {
    items.push(
      <Banner key="off" tone="muted" icon={<CloudOff className="h-4 w-4" />}>
        Нет подключения к интернету. Всё работает офлайн — документы хранятся на устройстве.
      </Banner>,
    );
  }
  if (!compact && !dismissed && persisted === false) {
    items.push(
      <Banner key="persist" tone="warn" icon={<ShieldAlert className="h-4 w-4" />} onClose={() => setSetting('storageNoticeDismissed', true)}>
        Документы хранятся только в этом браузере. Установите приложение на экран «Домой» и регулярно делайте резервные копии — при очистке данных сайта заметки будут удалены.
      </Banner>,
    );
  }
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 px-4 pt-2">{items}</div>;
}

function Banner({ children, icon, tone, onClose }: { children: React.ReactNode; icon: React.ReactNode; tone: 'error' | 'info' | 'warn' | 'muted'; onClose?: () => void }) {
  const toneClass = {
    error: 'bg-destructive/10 text-destructive border-destructive/20',
    info: 'bg-accent text-accent-foreground border-primary/20',
    warn: 'bg-[#ff9500]/10 text-[#b25f00] dark:text-[#ffb340] border-[#ff9500]/25',
    muted: 'bg-muted text-muted-foreground border-transparent',
  }[tone];
  return (
    <div role="status" className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] leading-snug ${toneClass}`}>
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-1 flex-wrap items-center">{children}</span>
      {onClose && (
        <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/5" aria-label="Скрыть">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

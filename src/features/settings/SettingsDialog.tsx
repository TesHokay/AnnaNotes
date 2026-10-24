import { useEffect, useState } from 'react';
import { Activity, Download, HardDrive, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider, Switch } from '@/components/ui/controls';
import { useSettings } from '@/store/settings';
import { THEMES } from '@/lib/theme';
import { useUI, errorMessage, navigate, toast } from '@/store/ui';
import { formatBytes, formatDate } from '@/lib/utils';
import { pickFiles } from '@/lib/files';
import { exportLibraryBackup, readBackupFile } from '@/features/actions';
import { RestoreDialog } from './RestoreDialog';
import type { ParsedBackup } from '@/backup/backup';
import { PressureTestPad } from './PressureTestPad';

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings();
  const persisted = useUI((u) => u.storagePersisted);
  const offlineReady = useUI((u) => u.offlineReady);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<ParsedBackup | null>(null);

  useEffect(() => {
    if (!open || !navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, [open]);

  const requestPersist = async () => {
    if (!navigator.storage?.persist) {
      toast('Браузер не поддерживает постоянное хранилище', { kind: 'error' });
      return;
    }
    const ok = await navigator.storage.persist();
    useUI.setState({ storagePersisted: ok });
    toast(ok ? 'Хранилище защищено от автоматической очистки' : 'Браузер отклонил запрос. Установите приложение на экран «Домой».', { kind: ok ? 'success' : 'info' });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Настройки</DialogTitle>
          </DialogHeader>

          <Section title="Оформление">
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => s.set('themeId', t.id)}
                  aria-pressed={s.themeId === t.id}
                  className={`flex flex-col items-center gap-1.5 rounded-md border p-2 text-[13px] transition-colors ${s.themeId === t.id ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
                >
                  <span className="flex h-8 w-full overflow-hidden rounded-[8px] ring-1 ring-black/10">
                    <span className="flex-1" style={{ background: t.swatch[0] }} />
                    <span className="w-1/3" style={{ background: t.swatch[1] }} />
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">Тема меняет только интерфейс. Цвет бумаги, PDF и рисунки не перекрашиваются.</p>
          </Section>

          <Section title="Apple Pencil и ввод">
            <Switch checked={s.stylusOnly} onChange={(v) => s.set('stylusOnly', v)} label="Рисовать только стилусом" description="Пальцы используются для прокрутки и масштабирования" />
            <Slider
              label="Чувствительность к нажатию"
              value={Math.round(s.calibration.sensitivity * 100)}
              min={0}
              max={100}
              onChange={(v) => s.set('calibration', { ...s.calibration, sensitivity: v / 100 })}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Полное нажатие (калибровка)"
              value={Math.round(s.calibration.ceiling * 100)}
              min={30}
              max={100}
              onChange={(v) => s.set('calibration', { ...s.calibration, ceiling: v / 100 })}
              format={(v) => `${v}%`}
            />
            <PressureTestPad />
            <p className="text-[12px] leading-snug text-muted-foreground">
              Если устройство не передаёт силу нажатия (мышь, палец, Apple Pencil без датчика давления), толщина линии меняется в зависимости от скорости.
            </p>
          </Section>

          <Section title="Хранилище и резервные копии">
            <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5 text-[14px]">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                {usage ? `Занято ${formatBytes(usage.usage)}${usage.quota ? ` из ${formatBytes(usage.quota)}` : ''}` : 'Объём хранилища недоступен'}
                <div className="text-[12px] text-muted-foreground">
                  {persisted ? 'Постоянное хранилище включено' : 'Браузер может очистить данные при нехватке места'}
                  {s.lastBackupAt ? ` · Последняя копия: ${formatDate(s.lastBackupAt)}` : ' · Резервных копий ещё не было'}
                </div>
              </div>
              {!persisted && (
                <Button size="sm" variant="outline" onClick={() => void requestPersist()}>
                  Защитить
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await exportLibraryBackup();
                  } catch (err) {
                    toast(errorMessage(err), { kind: 'error' });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download className="h-4 w-4" /> Копия всей библиотеки
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  const [file] = await pickFiles('.annanotes,.pencilnotes,.zip,application/zip');
                  if (!file) return;
                  try {
                    setRestore(await readBackupFile(file));
                  } catch (err) {
                    toast(errorMessage(err), { kind: 'error' });
                  }
                }}
              >
                <Upload className="h-4 w-4" /> Восстановить из копии
              </Button>
            </div>
          </Section>

          <Section title="Для разработчиков">
            <Switch checked={s.showPerf} onChange={(v) => s.set('showPerf', v)} label="Панель производительности" description="Время кадра, перерисовки, события ввода (Shift+P)" />
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <Activity className="h-4 w-4" /> Версия {__APP_VERSION__} · commit {__APP_COMMIT__} ·{' '}
              <span className={offlineReady ? 'text-[#2f9e5b]' : 'text-destructive'}>{offlineReady ? 'работает офлайн' : 'офлайн-кэш не готов'}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                navigate({ name: 'diagnostics' });
              }}
            >
              Диагностика PWA и хранилища
            </Button>
          </Section>
        </DialogContent>
      </Dialog>
      <RestoreDialog parsed={restore} onClose={() => setRestore(null)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

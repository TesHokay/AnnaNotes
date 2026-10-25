import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '@/db/repo';
import { Activity, Download, HardDrive, Heart, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider, Switch } from '@/components/ui/controls';
import { useSettings } from '@/store/settings';
import { THEMES } from '@/lib/theme';
import { isSplashEnabled, setSplashEnabled } from '@/features/splash/shuffleBag';
import { useUI, errorMessage, navigate, toast } from '@/store/ui';
import { formatBytes, formatDate } from '@/lib/utils';
import { pickFiles } from '@/lib/files';
import { exportLibraryBackup, readBackupFile } from '@/features/actions';
import { RestoreDialog } from './RestoreDialog';
import type { ParsedBackup } from '@/backup/backup';
import { PressureTestPad } from './PressureTestPad';
const SecretMessage = lazy(() => import('@/features/love/SecretMessage').then((m) => ({ default: m.SecretMessage })));

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings();
  const persisted = useUI((u) => u.storagePersisted);
  const offlineReady = useUI((u) => u.offlineReady);
  const [splashOn, setSplashOn] = useState(isSplashEnabled);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<ParsedBackup | null>(null);
  const [secret, setSecret] = useState(false);
  const taps = useRef<number[]>([]);

  // Five taps in a row on the little heart (each within 1.5 s of the previous) open the secret.
  const tapHeart = () => {
    const now = Date.now();
    const prev = taps.current;
    taps.current = prev.length && now - prev[prev.length - 1]! <= 1500 ? [...prev, now] : [now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setSecret(true);
      // EasterEggPreferences: when it was first found and how often it was opened.
      void getSetting<{ discoveredAt: number; opened: number } | null>('easterEgg', null).then((p) => setSetting('easterEgg', { discoveredAt: p?.discoveredAt ?? Date.now(), opened: (p?.opened ?? 0) + 1 })).catch(() => {});
    }
  };

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
            <Switch checked={splashOn} onChange={(v) => { setSplashEnabled(v); setSplashOn(v); }} label="Анимация при запуске" description="Каллиграфическая надпись «Я тебя люблю» на одном из семи языков" />
            <p className="text-[12px] text-muted-foreground">Тема меняет только интерфейс. Цвет бумаги, PDF и рисунки не перекрашиваются.</p>
          </Section>

          <Section title="Apple Pencil и ввод">
            <Switch checked={s.stylusOnly} onChange={(v) => s.set('stylusOnly', v)} label="Рисовать только стилусом" description="Пальцы используются для прокрутки и масштабирования" />
            <Slider
              label="Полное нажатие (калибровка)"
              value={Math.round(s.calibration.ceiling * 100)}
              min={30}
              max={100}
              onChange={(v) => s.set('calibration', { ...s.calibration, ceiling: v / 100 })}
              format={(v) => `${v}%`}
            />
            <h4 className="text-[15px] font-medium">Диагностика Apple Pencil</h4>
            <PressureTestPad />
            <p className="text-[12px] leading-snug text-muted-foreground">
              Кривая нажатия, минимальная толщина и сглаживание настраиваются отдельно для каждого пера (нажмите на активную ручку на панели инструментов). «Полное нажатие» задаёт, какая сила считается максимальной.
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
          <Section title="О приложении">
            <div className="flex items-center gap-2 text-[15px]">
              <span className="font-semibold">Pencil Notes</span>
              <button type="button" onClick={tapHeart} aria-label="Сердечко" className="-m-2 grid h-10 w-10 place-items-center rounded-full text-[var(--love-rose)] transition-transform active:scale-90" data-testid="about-heart">
                <Heart className="h-4 w-4 fill-current" />
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground">Рукописные заметки и PDF. Работает без интернета, всё хранится только на этом устройстве.</p>
          </Section>
        </DialogContent>
      </Dialog>
      {secret && (
        <Suspense fallback={null}>
          <SecretMessage open onClose={() => setSecret(false)} />
        </Suspense>
      )}
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

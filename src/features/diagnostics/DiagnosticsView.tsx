import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/button';
import { getDB, CURRENT_SCHEMA_VERSION } from '@/db/db';
import { checkForUpdate, swDiag } from '@/pwa/register';
import { formatBytes } from '@/lib/utils';
import { navigate, useUI } from '@/store/ui';

interface Report {
  sw: typeof swDiag & { controller: string | null; registrations: number };
  caches: { name: string; entries: number }[];
  precacheHasShell: boolean;
  precacheEntries: number;
  db: { ok: boolean; version: number | null; counts: Record<string, number>; error: string | null };
  storage: { usage: number; quota: number; persisted: boolean | null } | null;
  published: { version: string; commit: string; buildTime: string } | null;
  publishedError: string | null;
  standalone: boolean;
}

async function collect(): Promise<Report> {
  const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations().catch(() => []) : [];
  const cacheNames = typeof caches !== 'undefined' ? await caches.keys().catch(() => [] as string[]) : [];
  const cacheInfo: { name: string; entries: number }[] = [];
  let precacheHasShell = false;
  let precacheEntries = 0;
  for (const name of cacheNames) {
    const c = await caches.open(name);
    const keys = await c.keys();
    cacheInfo.push({ name, entries: keys.length });
    if (name.includes('precache')) {
      precacheEntries += keys.length;
      if (keys.some((k) => new URL(k.url).pathname === '/')) precacheHasShell = true;
    }
  }
  const db: Report['db'] = { ok: false, version: null, counts: {}, error: null };
  try {
    const d = getDB();
    await d.open();
    db.ok = true;
    db.version = d.verno;
    for (const t of ['notebooks', 'pages', 'elements', 'assets', 'folders'] as const) db.counts[t] = await d.table(t).count();
  } catch (err) {
    db.error = (err as Error).message;
  }
  let storage: Report['storage'] = null;
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    storage = { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : null };
  }
  let published: Report['published'] = null;
  let publishedError: string | null = null;
  if (navigator.onLine) {
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (r.ok) published = await r.json();
      else publishedError = `HTTP ${r.status}`;
    } catch (err) {
      publishedError = (err as Error).message;
    }
  } else publishedError = 'нет сети';
  return {
    sw: { ...swDiag, controller: navigator.serviceWorker?.controller?.scriptURL ?? null, registrations: regs.length },
    caches: cacheInfo,
    precacheHasShell,
    precacheEntries,
    db,
    storage,
    published,
    publishedError,
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

function Row({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 text-[14px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${ok === false ? 'text-destructive' : ok ? 'text-[#2f9e5b]' : ''}`}>{value}</span>
    </div>
  );
}

/** Developer diagnostics. Works fully offline (only the published-version check needs network). */
export function DiagnosticsView() {
  const [r, setR] = useState<Report | null>(null);
  const online = useUI((s) => s.online);
  const refresh = useCallback(() => void collect().then(setR), []);
  useEffect(refresh, [refresh, online]);

  const offlineOk = !!r && r.sw.controller !== null && r.precacheHasShell;
  return (
    <div className="pt-safe pb-safe flex h-full flex-col">
      <header className="glass flex h-14 items-center gap-2 border-b px-2">
        <IconButton label="Назад" onClick={() => navigate({ name: 'library' })}>
          <ChevronLeft className="h-6 w-6" />
        </IconButton>
        <h1 className="text-[17px] font-semibold">Диагностика</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh}>
          <RefreshCw className="h-4 w-4" /> Обновить
        </Button>
      </header>
      {!r ? (
        <p className="p-6 text-muted-foreground">Сбор данных…</p>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className={`mb-4 rounded-md p-4 text-[15px] ${offlineOk ? 'bg-[#2f9e5b]/10 text-[#22764a]' : 'bg-destructive/10 text-destructive'}`}>
            {offlineOk
              ? 'Офлайн-запуск готов: приложение управляется Service Worker, оболочка в кэше.'
              : r.standalone
                ? 'Офлайн-запуск НЕ готов. Установленное приложение хранит кэш отдельно от Safari — откройте его один раз с интернетом и дождитесь сообщения «работает без интернета».'
                : 'Офлайн-запуск НЕ готов. Обновите страницу при подключении к интернету.'}
          </div>
          <Section title="Приложение">
            <Row label="Версия" value={__APP_VERSION__} />
            <Row label="Commit" value={__APP_COMMIT__} />
            <Row label="Сборка" value={new Date(__APP_BUILD_TIME__).toLocaleString('ru-RU')} />
            <Row label="Опубликовано" value={r.published ? `${r.published.version} (${r.published.commit})` : r.publishedError} ok={r.published ? r.published.version === __APP_VERSION__ : undefined} />
            <Row label="Режим" value={r.standalone ? 'Установлено (Home Screen)' : 'Вкладка браузера'} />
            <Row label="Сеть" value={online ? 'онлайн' : 'офлайн'} />
          </Section>
          <Section title="Service Worker">
            <Row label="Поддержка" value={r.sw.supported ? 'да' : 'нет'} ok={r.sw.supported} />
            <Row label="Регистраций" value={r.sw.registrations} ok={r.sw.registrations > 0} />
            <Row label="Scope" value={r.sw.scope ?? '—'} />
            <Row label="Управляет страницей" value={r.sw.controller ? 'да' : 'нет'} ok={!!r.sw.controller} />
            <Row label="Ожидает обновление" value={r.sw.waiting ? 'да' : 'нет'} />
            <Row label="Последняя проверка обновлений" value={r.sw.lastUpdateCheck ? new Date(r.sw.lastUpdateCheck).toLocaleTimeString('ru-RU') : '—'} />
            <Row label="Ошибки" value={r.sw.lastError ?? 'нет'} ok={!r.sw.lastError} />
            <div className="pt-2">
              <Button size="sm" variant="secondary" disabled={!online} onClick={() => void checkForUpdate().then(refresh)}>
                Проверить обновление
              </Button>
            </div>
          </Section>
          <Section title="Кэш">
            <Row label="Оболочка (/) в precache" value={r.precacheHasShell ? 'да' : 'нет'} ok={r.precacheHasShell} />
            <Row label="Файлов в precache" value={r.precacheEntries} />
            {r.caches.map((c) => (
              <Row key={c.name} label={c.name} value={`${c.entries} записей`} />
            ))}
          </Section>
          <Section title="IndexedDB">
            <Row label="Состояние" value={r.db.ok ? 'открыта' : (r.db.error ?? 'ошибка')} ok={r.db.ok} />
            <Row label="Версия схемы" value={`${r.db.version ?? '—'} (ожидается ${CURRENT_SCHEMA_VERSION})`} ok={r.db.version === CURRENT_SCHEMA_VERSION} />
            {Object.entries(r.db.counts).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
            {r.storage && (
              <>
                <Row label="Занято" value={`${formatBytes(r.storage.usage)} из ${formatBytes(r.storage.quota)}`} />
                <Row label="Постоянное хранилище" value={r.storage.persisted ? 'да' : 'нет'} />
              </>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg bg-surface p-4 shadow-soft">
      <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

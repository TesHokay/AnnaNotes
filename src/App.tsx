import { lazy, Suspense, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Onboarding } from '@/components/app/Onboarding';
import { Toaster } from '@/components/app/Toaster';
import { getDB } from '@/db/db';
import { toStorageError } from '@/db/errors';
import { LibraryView } from '@/features/library/LibraryView';
import { useSettings } from '@/store/settings';
import { initUIListeners, useUI } from '@/store/ui';

const DiagnosticsView = lazy(() => import('@/features/diagnostics/DiagnosticsView').then((m) => ({ default: m.DiagnosticsView })));
const EditorView = lazy(() => import('@/features/editor/EditorView').then((m) => ({ default: m.EditorView })));

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = dark ? '#161013' : '#fcf1f5';
      document.head.appendChild(meta);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground" role="status" aria-label="Загрузка">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

export function App() {
  const route = useUI((s) => s.route);
  const dbError = useUI((s) => s.dbError);
  const loaded = useSettings((s) => s.loaded);
  useTheme();

  useEffect(() => {
    const dispose = initUIListeners();
    (async () => {
      try {
        await getDB().open();
      } catch (err) {
        useUI.setState({ dbError: toStorageError(err).message });
      }
      await useSettings.getState().load();
      if (navigator.storage?.persisted) {
        const persisted = await navigator.storage.persisted().catch(() => false);
        useUI.setState({ storagePersisted: persisted });
      }
    })();
    return dispose;
  }, []);

  if (dbError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <h1 className="text-lg font-semibold">Хранилище недоступно</h1>
        <p className="max-w-md text-[15px] text-muted-foreground">{dbError}</p>
      </div>
    );

  return (
    <>
      {!loaded ? (
        <Splash />
      ) : route.name === 'diagnostics' ? (
        <Suspense fallback={<Splash />}>
          <DiagnosticsView />
        </Suspense>
      ) : route.name === 'notebook' ? (
        <Suspense fallback={<Splash />}>
          <EditorView key={route.id} id={route.id} />
        </Suspense>
      ) : (
        <LibraryView />
      )}
      <Onboarding />
      <Toaster />
    </>
  );
}

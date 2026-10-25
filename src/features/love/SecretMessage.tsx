import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { composeLines } from '@/features/splash/compose';
import { SECRET_LINES } from '@/features/splash/glyphs';
import { InkCanvas } from '@/features/splash/InkCanvas';

/**
 * The secret screen: «Сделано с любовью. Специально для тебя ♡» written by the same calligraphy
 * pen as the launch animation, then a small line underneath. The text stays until closed.
 */
export function SecretMessage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [written, setWritten] = useState(false);
  const comp = useMemo(() => (open ? composeLines(SECRET_LINES, { maxWriteMs: 6500 }) : null), [open]);
  const reduced = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setWritten(false);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="secret-message pt-safe pb-safe pl-safe pr-safe fixed inset-0 z-[120] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          data-testid="secret-message"
        >
          <DialogPrimitive.Title className="sr-only">Сделано с любовью. Специально для тебя</DialogPrimitive.Title>
          {comp && (
            <InkCanvas
              comp={comp}
              animate={!reduced}
              label="Сделано с любовью. Специально для тебя ♡"
              className="absolute inset-0"
              fit={(w, h) => ({ maxWidth: w * 0.86, maxHeight: h * 0.4, maxScale: 1.45, cx: w / 2, cy: h * 0.45 })}
              onComplete={() => setWritten(true)}
            />
          )}
          <p
            className={`secret-message__sub absolute inset-x-6 bottom-[calc(env(safe-area-inset-bottom)+12%)] text-center font-serif text-[17px] italic leading-snug transition-all duration-1000 ease-out ${written ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
          >
            В каждой строчке — немного моей любви
          </p>
          <DialogPrimitive.Close
            className="secret-message__close absolute right-[calc(env(safe-area-inset-right)+12px)] top-[calc(env(safe-area-inset-top)+12px)] grid h-10 w-10 place-items-center rounded-full"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

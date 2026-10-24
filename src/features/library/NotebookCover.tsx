import { memo, useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { getDB } from '@/db/db';
import { pageThumbnail } from '@/export/pageRaster';
import type { Notebook } from '@/model/types';
import { cn } from '@/lib/utils';

/** First page thumbnail for PDFs (rendered lazily when scrolled into view). */
function PdfCover({ nb }: { nb: Notebook }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void (async () => {
        const page = await getDB().pages.where('[notebookId+order]').between([nb.id, -Infinity], [nb.id, Infinity]).first();
        if (!page || cancelled) return;
        try {
          const u = await pageThumbnail(page, nb.updatedAt, 240);
          if (!cancelled) setUrl(u);
        } catch {
          /* fall back to the icon */
        }
      })();
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [nb.id, nb.updatedAt]);
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center overflow-hidden rounded-[10px] bg-white shadow-soft ring-1 ring-black/5">
      {url ? <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} /> : <FileText className="h-10 w-10 text-muted-foreground/50" />}
    </div>
  );
}

export const NotebookCover = memo(function NotebookCover({ nb, className }: { nb: Notebook; className?: string }) {
  return (
    <div className={cn('relative aspect-[3/4] w-full', className)}>
      {nb.kind === 'pdf' ? (
        <PdfCover nb={nb} />
      ) : (
        <div className="relative h-full w-full overflow-hidden rounded-l-[6px] rounded-r-[12px] shadow-soft" style={{ background: nb.coverColor }}>
          <div className="absolute inset-y-0 left-0 w-[9%] bg-black/15" />
          <div className="absolute inset-y-0 left-[9%] w-px bg-white/25" />
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/10" />
          <div className="absolute left-[18%] right-[10%] top-[16%] rounded-[6px] bg-white/90 px-2 py-1.5 shadow-sm">
            <div className="line-clamp-2 text-[11px] font-semibold leading-tight text-neutral-800">{nb.title}</div>
          </div>
        </div>
      )}
    </div>
  );
});

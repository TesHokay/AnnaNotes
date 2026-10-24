import type { PageTemplate } from '@/model/types';
import { isDarkPaper } from '@/model/paper';

/** Tiny SVG preview of a paper template. */
export function TemplatePreview({ template, paperColor, landscape }: { template: PageTemplate; paperColor: string; landscape?: boolean }) {
  const w = landscape ? 56 : 40;
  const h = landscape ? 40 : 56;
  const stroke = isDarkPaper(paperColor) ? 'rgba(255,255,255,0.3)' : 'rgba(60,90,140,0.35)';
  const lines: React.ReactNode[] = [];
  if (template === 'lined') for (let y = 12; y < h - 2; y += 5) lines.push(<line key={y} x1={0} x2={w} y1={y} y2={y} stroke={stroke} strokeWidth={0.6} />);
  if (template === 'grid') {
    for (let y = 4; y < h; y += 4) lines.push(<line key={`h${y}`} x1={0} x2={w} y1={y} y2={y} stroke={stroke} strokeWidth={0.4} />);
    for (let x = 4; x < w; x += 4) lines.push(<line key={`v${x}`} y1={0} y2={h} x1={x} x2={x} stroke={stroke} strokeWidth={0.4} />);
  }
  if (template === 'dotted') for (let y = 4; y < h; y += 4) for (let x = 4; x < w; x += 4) lines.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={0.5} fill={stroke} />);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rounded-[4px] shadow-soft" aria-hidden>
      <rect width={w} height={h} fill={paperColor} />
      {lines}
    </svg>
  );
}

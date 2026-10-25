import { useId } from 'react';
import { paperDecor, resolveRuling } from '@/model/cutePaper';
import { pageDimensions } from '@/model/paper';
import type { PageTemplate, PaperStyle } from '@/model/types';

/**
 * Small vector preview of a paper: the same ruling and decorations as the real page, drawn in
 * page units and scaled down (SVG patterns keep it to a handful of DOM nodes).
 */
export function TemplatePreview({ template, paperColor, style, landscape, width = 40 }: { template: PageTemplate; paperColor: string; style?: PaperStyle; landscape?: boolean; width?: number }) {
  const id = useId().replace(/:/g, '');
  const dims = pageDimensions('A4', landscape ? 'landscape' : 'portrait');
  const page = { ...dims, template, paperColor, style };
  const r = resolveRuling(page);
  const decor = paperDecor(page);
  const s = r.spacing;
  const h = (width * dims.height) / dims.width;
  // Lines get thicker in page units so they stay visible at preview size.
  const line = 1.6;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${dims.width} ${dims.height}`} className="shrink-0 rounded-[4px] shadow-soft ring-1 ring-black/5" aria-hidden>
      <defs>
        {template === 'grid' && (
          <pattern id={`g${id}`} width={s} height={s} patternUnits="userSpaceOnUse">
            <path d={`M${s} 0V${s}M0 ${s}H${s}`} stroke={r.color} strokeOpacity={Math.min(1, r.alpha + 0.15)} strokeWidth={line} fill="none" />
          </pattern>
        )}
        {template === 'dotted' && (
          <pattern id={`g${id}`} width={s} height={s} patternUnits="userSpaceOnUse">
            <circle cx={s} cy={s} r={2.4} fill={r.color} fillOpacity={Math.min(1, r.alpha + 0.3)} />
          </pattern>
        )}
        {template === 'lined' && (
          <pattern id={`g${id}`} width={dims.width} height={s} patternUnits="userSpaceOnUse">
            <path d={`M0 ${s}H${dims.width}`} stroke={r.color} strokeOpacity={Math.min(1, r.alpha + 0.15)} strokeWidth={line} />
          </pattern>
        )}
      </defs>
      <rect width={dims.width} height={dims.height} fill={paperColor} />
      {decor.filter((d) => d.layer === 'under').map((d, i) => <path key={`u${i}`} d={d.d} fill={d.fill} fillOpacity={d.opacity} />)}
      {template !== 'blank' && <rect y={template === 'lined' ? s * 2.5 : 0} width={dims.width} height={dims.height} fill={`url(#g${id})`} />}
      {template === 'lined' && r.margin && <path d={`M${s * 3} 0V${dims.height}`} stroke="rgb(230,80,80)" strokeOpacity={0.4} strokeWidth={line} />}
      {decor.filter((d) => d.layer === 'over').map((d, i) => <path key={`o${i}`} d={d.d} fill={d.fill} fillOpacity={d.opacity} />)}
    </svg>
  );
}

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-md border border-input bg-surface px-3 text-[16px] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-1.5 text-[13px] font-medium text-muted-foreground', className)}>{children}</div>;
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-1">
      <span className="flex flex-col">
        <span className="text-[15px]">{label}</span>
        {description && <span className="text-[13px] text-muted-foreground">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}
      >
        <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="radiogroup" className={cn('flex rounded-md bg-muted p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 text-sm font-medium transition-all',
            value === o.value ? 'bg-surface shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[13px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full cursor-pointer accent-[hsl(var(--primary))]"
      />
    </label>
  );
}

export function ColorSwatch({ color, active, onClick, size = 32, label }: { color: string; active?: boolean; onClick: () => void; size?: number; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label ?? color}
      aria-pressed={active}
      onClick={onClick}
      className={cn('relative grid shrink-0 place-items-center rounded-full ring-offset-2 ring-offset-popover transition-transform active:scale-90', active && 'ring-2 ring-primary')}
      style={{ width: size, height: size, background: color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)' }}
    >
      {active && <Check className="h-4 w-4" style={{ color: isLight(color) ? '#000' : '#fff' }} />}
    </button>
  );
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
}

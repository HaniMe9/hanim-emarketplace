import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import { STATUS_TONE, statusLabel } from '../lib/format.ts';
import { t } from '../lib/i18n/index.ts';
import clsx from 'clsx';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand' | 'gold' | 'violet';

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  info: 'bg-info-soft text-info border-info/25',
  muted: 'bg-surface-2 text-ink-3 border-line',
  brand: 'bg-brand-soft text-brand-ink border-brand/25',
  gold: 'bg-gold-soft text-gold-ink border-gold/30',
  violet: 'bg-violet-soft text-violet border-violet/25',
};

/* --------------------------------- Badge -------------------------------- */

export function Badge({
  children,
  tone = 'muted',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Status pill driven by the shared status→tone map. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'muted'} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

export function Dot({ tone = 'brand', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const color: Record<Tone, string> = {
    ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', muted: 'bg-ink-3',
    brand: 'bg-brand', gold: 'bg-gold', violet: 'bg-violet',
  };
  return <span className={clsx('inline-block size-2 shrink-0 rounded-full', color[tone], pulse && 'animate-pulse-ring')} />;
}

/* -------------------------------- Button -------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-brand text-white hover:bg-brand-strong border-transparent shadow-sm disabled:bg-brand/50',
    secondary: 'bg-surface text-ink border-line hover:bg-surface-2 hover:border-line-strong',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink',
    danger: 'bg-bad-soft text-bad border-bad/30 hover:bg-bad hover:text-white',
    gold: 'bg-gold text-ink hover:brightness-105 border-transparent shadow-sm',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-base gap-2.5',
  };
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-md border font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- Card --------------------------------- */

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  /**
   * `min-w-0` is load-bearing. A grid or flex item defaults to `min-width: auto`,
   * which floors it at its own min-content width — and a card whose text is
   * `truncate`d or `whitespace-nowrap` has a min-content width as wide as that
   * text. The item then refuses to shrink, an `auto` grid track grows to match it,
   * and the card hangs off the right edge of the page on a phone. Zeroing the
   * automatic minimum lets the track stay at the column width and the truncation
   * inside the card actually engage.
   */
  return <As className={clsx('card min-w-0 p-4 sm:p-5', className)}>{children}</As>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-brand">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -------------------------------- Inputs -------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={clsx('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-ink-2">
          {label}
          {required && <span className="text-bad">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-bad">
          <AlertTriangle className="size-3" /> {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>
      )}
    </label>
  );
}

const inputBase =
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-brand focus:outline-none disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputBase, 'h-10', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputBase, 'py-2 leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputBase, 'h-10 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5', disabled && 'cursor-not-allowed opacity-60')}>
      <span
        className={clsx(
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border transition-colors',
          checked ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

/* ----------------------------- Layout helpers --------------------------- */

export function Grid({ cols = 4, children, className }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode; className?: string }) {
  const map = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  };
  return <div className={clsx('grid gap-3 sm:gap-4', map[cols], className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone = 'muted',
  icon,
  trend,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
        {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
      </div>
      <p className={clsx('mt-2 font-display text-2xl font-bold tabular-nums', tone === 'muted' ? 'text-ink' : `text-${tone}`)}>
        {value}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {trend && (
          <Badge tone={trend.value >= 0 ? 'ok' : 'bad'}>
            {trend.value >= 0 ? '+' : ''}
            {trend.value.toFixed(1)}%
          </Badge>
        )}
        {sub && <span className="text-[11px] text-ink-3">{sub}</span>}
      </div>
    </Card>
  );
}

export function Row({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0',
        onClick && 'cursor-pointer hover:bg-surface-2',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function KeyValue({ k, v, mono = false }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-ink-3">{k}</span>
      <span className={clsx('text-right text-sm font-semibold text-ink', mono && 'font-mono tabular-nums')}>{v}</span>
    </div>
  );
}

/* ------------------------------ Feedback -------------------------------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3">
      <Loader2 className="size-4 animate-spin" />
      {label ?? t('Loading…')}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton h-4 w-full', className)} />;
}

export function Empty({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {message && <p className="max-w-sm text-xs leading-relaxed text-ink-3">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-bad/25 bg-bad-soft px-4 py-3">
      <AlertTriangle className="size-4 shrink-0 text-bad" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-bad">{message}</p>
      {onRetry && (
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          {t('Retry')}
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  onClose,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-xs leading-relaxed', TONE_CLASS[tone], className)}>
      <div className="min-w-0 flex-1">
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        <div className={clsx(title && 'opacity-90')}>{children}</div>
      </div>
      {onClose && (
        <button className="shrink-0 opacity-60 hover:opacity-100" onClick={onClose} aria-label={t('Dismiss')}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          className={clsx(
            'relative shrink-0 px-3 py-2.5 text-sm font-semibold transition-colors',
            value === t.id ? 'text-brand' : 'text-ink-3 hover:text-ink',
          )}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-2">{t.count}</span>
          )}
          {value === t.id && <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-brand" />}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max = 100, tone = 'brand' }: { value: number; max?: number; tone?: 'brand' | 'ok' | 'warn' | 'bad' | 'gold' }) {
  const width = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100));
  const colors: Record<string, string> = {
    brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', gold: 'bg-gold',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={clsx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Avatar({ name, hue = 180, size = 36 }: { name: string; hue?: number; size?: number }) {
  const letters = name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, oklch(58% 0.12 ${hue}), oklch(46% 0.1 ${hue + 30}))`,
      }}
    >
      {letters}
    </span>
  );
}

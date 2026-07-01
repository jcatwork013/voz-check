import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------- Card ----------------
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-white/10 bg-white/[0.04] shadow-card backdrop-blur-xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/25">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-base font-semibold text-slate-50">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

// ---------------- Button ----------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: 'sm' | 'md';
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-glow hover:from-brand-400 hover:to-violet-400 hover:shadow-glow focus-visible:ring-brand-400/50 disabled:opacity-50 disabled:shadow-none',
  secondary:
    'bg-white/[0.06] text-slate-200 border border-white/15 hover:bg-white/[0.1] focus-visible:ring-white/20',
  ghost: 'bg-transparent text-slate-300 hover:bg-white/[0.06] focus-visible:ring-white/10',
  danger:
    'bg-rose-600 text-white hover:bg-rose-500 shadow-[0_0_18px_-4px_rgba(244,63,94,0.6)] focus-visible:ring-rose-400/50 disabled:opacity-50',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_18px_-4px_rgba(16,185,129,0.6)] focus-visible:ring-emerald-400/50 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  loading = false,
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        buttonVariants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

// ---------------- Input ----------------
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, className, id, ...rest },
  ref,
) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="label-base">
          {label}
        </label>
      )}
      <input ref={ref} id={id} className={cx('input-base', className)} {...rest} />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

// ---------------- Textarea ----------------
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, className, id, ...rest },
  ref,
) {
  return (
    <div className="flex flex-col">
      {label && (
        <label htmlFor={id} className="label-base">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        className={cx('input-base resize-y font-mono text-[13px] leading-relaxed', className)}
        {...rest}
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

// ---------------- Select ----------------
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, className, id, children, ...rest },
  ref,
) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="label-base">
          {label}
        </label>
      )}
      <select ref={ref} id={id} className={cx('input-base pr-9', className)} {...rest}>
        {children}
      </select>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

// ---------------- Toggle ----------------
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const dims =
    size === 'lg'
      ? { track: 'h-7 w-12', knob: 'h-6 w-6', on: 'translate-x-5' }
      : { track: 'h-6 w-11', knob: 'h-5 w-5', on: 'translate-x-5' };
  return (
    <label className={cx('inline-flex items-center gap-3', disabled && 'opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex flex-none items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50',
          dims.track,
          checked ? 'bg-gradient-to-r from-brand-500 to-violet-500 shadow-glow-sm' : 'bg-white/15',
          disabled && 'cursor-not-allowed',
        )}
      >
        <span
          className={cx(
            'inline-block transform rounded-full bg-white shadow transition',
            dims.knob,
            checked ? dims.on : 'translate-x-0.5',
          )}
        />
      </button>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  );
}

// ---------------- Badge ----------------
type BadgeTone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const badgeTones: Record<BadgeTone, string> = {
  gray: 'bg-white/10 text-slate-300 ring-white/15',
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  blue: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  violet: 'bg-brand-500/15 text-brand-300 ring-brand-500/30',
};

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------- States ----------------
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-5 w-5 animate-spin text-brand-300', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 py-10 px-6 text-center">
      <svg className="h-8 w-8 text-rose-400" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M8.3 2.3a2 2 0 0 1 3.4 0l6.5 11A2 2 0 0 1 16.5 16h-13a2 2 0 0 1-1.7-2.7l6.5-11zM10 7a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1zm0 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
          clipRule="evenodd"
        />
      </svg>
      <p className="text-sm font-medium text-rose-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function EmptyBlock({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-400">
      {icon ?? (
        <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.75h16.5m-16.5 4.5h16.5m-13.5-9 9 13.5" />
        </svg>
      )}
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ---------------- Helper: confidence badge ----------------
export function ConfidenceBadge({ value, threshold }: { value: number; threshold?: number }) {
  const tone: BadgeTone = value >= 75 ? 'red' : value >= 50 ? 'amber' : 'green';
  const flagged = threshold !== undefined && value >= threshold;
  return (
    <Badge tone={tone} className={flagged ? 'ring-2' : undefined}>
      {Math.round(value)}%
    </Badge>
  );
}

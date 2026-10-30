import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { SEV_COLOR, SEV_SOFT, STATUS_STYLE, TYPE_META } from '../lib/constants';

const spring = { type: 'spring', stiffness: 420, damping: 22 };

/** Clay button with a squishy spring press */
export function ClayButton({ variant = 'sky', size, className = '', loading, children, ...rest }) {
  const base = variant === 'sun' ? 'clay-btn-sun' : variant === 'white' ? 'clay-btn-white' : 'clay-btn';
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.94, y: 1 }}
      transition={spring}
      className={`${base} ${size === 'sm' ? 'clay-btn-sm' : ''} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

/** Glass panel. `interactive` adds the hover lift used for clickable cards */
export function Glass({ as = 'div', interactive, className = '', children, ...rest }) {
  const C = motion[as] || motion.div;
  return (
    <C
      whileHover={interactive ? { y: -4, boxShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 30px 60px -22px rgba(46,95,170,.42)' } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`glass ${className}`}
      {...rest}
    >
      {children}
    </C>
  );
}

export function SeverityPill({ value }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
      style={{ background: SEV_SOFT[value], color: '#1E2A44' }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[value] }} />
      {value}
    </span>
  );
}

export function StatusPill({ value }) {
  const s = STATUS_STYLE[value] || STATUS_STYLE.Rejected;
  return (
    <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: s.bg, color: s.fg }}>
      {value}
    </span>
  );
}

export function TypeBadge({ value, size = 'md' }) {
  const m = TYPE_META[value] || TYPE_META.Other;
  const Icon = m.icon;
  const box = size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl';
  return (
    <span className={`inline-grid shrink-0 place-items-center ${box}`} style={{ background: `${m.color}22`, color: m.color }}>
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}

/** Neumorphic segmented control */
export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex flex-wrap gap-2 ${className}`} role="radiogroup">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            data-on={value === v}
            onClick={() => onChange(v)}
            className="neu-chip"
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-extrabold text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="grid place-items-center gap-2 py-10 text-ink-soft" role="status">
      <Loader2 className="h-7 w-7 animate-spin text-sky" />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-1 grid h-14 w-14 place-items-center rounded-3xl bg-sky-soft text-sky shadow-clay-white">
          <Icon className="h-7 w-7" />
        </span>
      )}
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-coral/30 bg-coral-soft/80 px-4 py-3 text-sm font-semibold text-ink">
      <span>{message}</span>
      {onRetry && <ClayButton size="sm" variant="white" onClick={onRetry}>Try again</ClayButton>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/70 ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="glass space-y-3 p-5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-3 w-52" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-xl" />
      ))}
    </div>
  );
}

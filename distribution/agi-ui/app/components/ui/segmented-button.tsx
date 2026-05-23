// SPDX-License-Identifier: Apache-2.0
'use client';

import { cn } from '@/lib/utils';

/**
 * Material Design 3 segmented button group (single-select).
 *
 * Pill-shaped connected segments; the active segment gets a check icon
 * and the secondary-container background, exactly the way the spec calls
 * it. Used for range / mode pickers (audit time-range, density, etc.).
 */
interface Option {
  value: string;
  label: string;
}

interface SegmentedButtonProps {
  value: string;
  options: Array<string | Option>;
  onChange: (next: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedButton({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SegmentedButtonProps) {
  const normalised: Option[] = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  );
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-10 items-stretch overflow-hidden rounded-full border',
        className,
      )}
      style={{ borderColor: 'var(--md-outline)' }}
    >
      {normalised.map((opt, idx) => {
        const active = opt.value === value;
        const isFirst = idx === 0;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center gap-1.5 px-4 text-[13px] font-medium tracking-wide transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)]',
              active
                ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
                : 'text-[var(--md-on-surface-variant)] hover:bg-[var(--md-on-surface)]/8',
              !isFirst && 'border-l',
            )}
            style={{ borderColor: 'var(--md-outline)' }}
          >
            {active && (
              <span aria-hidden className="text-sm leading-none">
                ✓
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

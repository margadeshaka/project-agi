// SPDX-License-Identifier: Apache-2.0
'use client';

import { cn } from '@/lib/utils';

/**
 * Material Design 3 filter chip.
 *
 * Outlined when not selected; on select grows a leading check icon and
 * flips to a filled secondary-container background. Used in the audit
 * filters, tool catalogue, pack picker etc.
 */
interface FilterChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function FilterChip({ label, selected = false, onClick, className }: FilterChipProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium tracking-wide transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--md-surface)]',
        selected
          ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
          : 'border border-[var(--md-outline)] text-[var(--md-on-surface-variant)] hover:bg-[var(--md-on-surface)]/8',
        className,
      )}
    >
      {selected && (
        <span aria-hidden className="text-sm leading-none">
          ✓
        </span>
      )}
      {label}
    </button>
  );
}

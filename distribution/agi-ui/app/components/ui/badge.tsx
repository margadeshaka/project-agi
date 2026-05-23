// SPDX-License-Identifier: Apache-2.0
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Material Design 3 chips and the legacy ``Badge`` alias.
 *
 * The M3 chip vocabulary covers a lot of what we previously did with a
 * "badge" — assist / filter / input / suggestion chips share visual DNA but
 * differ in interaction. For this initial port we expose the tonal flavours
 * we actually use on screens:
 *
 *   - neutral / accent / good / warn / bad / info — short status tags
 *   - read / write                                 — tool side-effect class
 *
 * Side-effect tones double-encode their meaning with a leading glyph so
 * they remain distinguishable for colour-blind users (FR-TOOL-01 AC).
 */
/**
 * Canonical M3-flavoured tones live in the dark-side palette
 * (good/warn/bad). The lighter alias names (success/warning/danger) are
 * preserved so existing screens compile without churn.
 */
type Tone =
  | 'neutral'
  | 'accent'
  | 'good'
  | 'warn'
  | 'bad'
  | 'info'
  | 'read'
  | 'write'
  | 'success'
  | 'warning'
  | 'danger';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneStyle: Record<Tone, string> = {
  neutral:
    'bg-[var(--md-surface-container-high)] text-[var(--md-on-surface-variant)]',
  accent:
    'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]',
  good:
    'bg-[var(--md-success-container)] text-[var(--md-on-success-container)]',
  warn:
    'bg-[var(--md-warning-container)] text-[var(--md-on-warning-container)]',
  bad: 'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]',
  info: 'bg-[var(--md-info-container)] text-[var(--md-on-primary-container)]',
  read:
    'bg-[var(--md-success-container)] text-[var(--md-on-success-container)]',
  write: 'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]',
  // aliases
  success:
    'bg-[var(--md-success-container)] text-[var(--md-on-success-container)]',
  warning:
    'bg-[var(--md-warning-container)] text-[var(--md-on-warning-container)]',
  danger:
    'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]',
};

const tonePrefix: Partial<Record<Tone, string>> = {
  write: '◆ ',
  read: '○ ',
};

export function Badge({
  className,
  tone = 'neutral',
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-medium tracking-wide whitespace-nowrap',
        toneStyle[tone],
        className,
      )}
      {...props}
    >
      {tonePrefix[tone]}
      {children}
    </span>
  );
}

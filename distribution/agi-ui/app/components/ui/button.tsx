// SPDX-License-Identifier: Apache-2.0
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Material Design 3 button.
 *
 * Variant maps to the M3 button family:
 *   - filled        → filled (primary action)
 *   - tonal         → filled tonal (the default — secondary actions)
 *   - outlined      → outlined
 *   - text          → text
 *   - danger        → filled error-container
 *   - icon          → 40×40 circular icon button (state layer on hover)
 *
 * All variants are pill-shaped (`rounded-full`) per the M3 shape scale
 * except `icon`, which is fully round.
 */
type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'icon';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyle: Record<Variant, string> = {
  filled:
    'bg-[var(--md-primary)] text-[var(--md-on-primary)] hover:shadow-[var(--md-elev-1)]',
  tonal:
    'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] hover:shadow-[var(--md-elev-1)]',
  outlined:
    'border border-[var(--md-outline)] bg-transparent text-[var(--md-primary)] hover:bg-[var(--md-primary)]/8',
  text: 'bg-transparent text-[var(--md-primary)] hover:bg-[var(--md-primary)]/8',
  danger:
    'bg-[var(--md-error-container)] text-[var(--md-on-error-container)] hover:shadow-[var(--md-elev-1)]',
  icon: 'bg-transparent text-[var(--md-on-surface-variant)] hover:bg-[var(--md-on-surface)]/8 rounded-full',
};

const sizeStyle: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-xs',
  md: 'h-10 px-5 text-[13.5px]',
  lg: 'h-12 px-6 text-sm',
};

const iconSizeStyle: Record<Size, string> = {
  sm: 'h-9 w-9',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'tonal', size = 'md', type, ...props },
  ref,
) {
  const isIcon = variant === 'icon';
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium tracking-wide whitespace-nowrap transition-shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--md-surface)]',
        'disabled:pointer-events-none disabled:opacity-40',
        isIcon ? iconSizeStyle[size] : `${sizeStyle[size]} rounded-full`,
        variantStyle[variant],
        className,
      )}
      {...props}
    />
  );
});

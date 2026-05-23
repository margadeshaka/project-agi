// SPDX-License-Identifier: Apache-2.0
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Material Design 3 cards.
 *
 * The M3 system uses tonal elevation rather than borders + drop shadows:
 *
 *   - filled (default) → surface-container-low, no border, 12px radius
 *   - elevated         → surface-container, elev-1 shadow
 *   - outlined         → bare surface + outline-variant border (for screens
 *                        that need a hairline divide rather than a tonal lift)
 */
type Variant = 'filled' | 'elevated' | 'outlined' | 'primary' | 'secondary';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variantStyle: Record<Variant, string> = {
  filled: 'bg-[var(--md-surface-container-low)]',
  elevated: 'bg-[var(--md-surface-container)] shadow-[var(--md-elev-1)]',
  outlined: 'bg-[var(--md-surface)] border border-[var(--md-outline-variant)]',
  primary:
    'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]',
  secondary:
    'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]',
};

export function Card({ className, variant = 'filled', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl p-5 text-[var(--md-on-surface)]',
        variantStyle[variant],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-3 flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-sm font-medium tracking-normal text-[var(--md-on-surface)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-[var(--md-on-surface-variant)]', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-3 text-sm', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-4 flex items-center gap-2 pt-3 border-t border-[var(--md-outline-variant)]',
        className,
      )}
      {...props}
    />
  );
}

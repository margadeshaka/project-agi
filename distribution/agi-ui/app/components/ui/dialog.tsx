// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * Minimal a11y-correct modal — radix would be ideal but we keep zero-dep
 * to stay under the 250 KB gzipped budget (NFR-PERF-01). Focus trap is
 * basic: focus the close button on open, restore on close.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    closeRef.current?.focus();
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, handleKey]);

  if (!open) return null;
  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-labelledby="dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="text-base font-semibold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 text-sm">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

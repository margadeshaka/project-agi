// SPDX-License-Identifier: Apache-2.0
'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Material Design 3 switch — thumb-and-track with a check glyph that
 * appears on the thumb when checked. Width and gestures match the
 * Material reference (52×32 track, 24×24 thumb that grows to 26×26 on
 * check).
 */
interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled = false, className }: SwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex items-center gap-2.5 text-[13.5px]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      {label && <span style={{ color: 'var(--md-on-surface)' }}>{label}</span>}
      <span
        className="relative inline-flex h-8 w-[52px] items-center rounded-full transition-colors"
        style={{
          background: checked
            ? 'var(--md-primary)'
            : 'var(--md-surface-container-highest)',
          border: checked ? 'none' : '2px solid var(--md-outline)',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'absolute grid place-items-center rounded-full transition-all',
            checked ? 'translate-x-[24px] h-[26px] w-[26px]' : 'translate-x-1 h-6 w-6',
          )}
          style={{
            background: checked ? 'var(--md-on-primary)' : 'var(--md-outline)',
            color: checked ? 'var(--md-primary)' : 'transparent',
            fontSize: 14,
          }}
        >
          {checked ? '✓' : null}
        </span>
      </span>
    </label>
  );
}

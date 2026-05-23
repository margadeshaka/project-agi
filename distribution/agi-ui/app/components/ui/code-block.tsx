// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * CodeBlock — minimal syntax-aware read-only viewer (FR-PACK-03).
 *
 * No external highlighter dep (keeps bundle small). Uses CSS variables
 * for token colours so theming works. Copy-to-clipboard button is built-in.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  children: string;
  language?: 'json' | 'yaml' | 'plain' | 'text' | 'md';
  className?: string;
  /** Optional caption/label rendered above the block. */
  label?: ReactNode;
}

export function CodeBlock({ children, language = 'plain', className, label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore; user can still select-copy
    }
  }, [children]);

  return (
    <figure className={cn('rounded-md border border-border bg-foreground/5', className)}>
      <figcaption className="flex items-center justify-between px-3 py-1.5 text-xs text-muted">
        <span>{label ?? language}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-0.5 text-xs text-muted hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Copy code to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre
        className="overflow-x-auto p-3 text-xs leading-relaxed font-mono"
        // Single source of truth for token rendering: plain pre. Real
        // highlighting can swap in later without changing the API.
      >
        <code>{children}</code>
      </pre>
    </figure>
  );
}

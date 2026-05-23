// SPDX-License-Identifier: Apache-2.0
/**
 * EmptyState + ErrorState — required by FR-IA-04 for every page.
 * No raw 5xx dumps; consistent shape across the console.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ProblemDetails } from '@/lib/api/types';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-12 text-center',
        className,
      )}
    >
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  problem: ProblemDetails;
  /** Where the user should go to retry / go back. */
  retry?: ReactNode;
  className?: string;
}

export function ErrorState({ problem, retry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'space-y-2 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm',
        className,
      )}
    >
      <div className="font-semibold text-danger">{problem.title}</div>
      {problem.detail && <p className="text-foreground">{problem.detail}</p>}
      {problem.type && (
        <a
          href={problem.type}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent underline"
        >
          More info ↗
        </a>
      )}
      {retry && <div className="pt-1">{retry}</div>}
    </div>
  );
}

export function ForbiddenState({ className }: { className?: string }) {
  return (
    <EmptyState
      title="You don't have access to this page"
      description={
        <>
          Your session doesn&apos;t include the scopes required to view this resource.
          Ask your platform admin to update your OIDC role mapping.
        </>
      }
      action={
        <a href="/" className="text-sm text-accent underline">
          Back to Health
        </a>
      }
      className={className}
    />
  );
}

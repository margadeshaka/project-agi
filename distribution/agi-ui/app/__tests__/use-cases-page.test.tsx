// SPDX-License-Identifier: Apache-2.0
/**
 * /use-cases header — Langfuse link rendering (4b-C).
 *
 * The page-level server component does the fetch; the visible UI lives in
 * <UseCasesView>, which takes ``langfuseUrl`` as a typed prop. The link must
 * appear when the URL is present and stay absent when it isn't (planner
 * decision: hide rather than render a disabled affordance).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UseCasesView } from '../use-cases/use-cases-view';

afterEach(() => {
  cleanup();
});

describe('UseCasesView Langfuse header link', () => {
  it('renders an external link to Langfuse when langfuseUrl is present', () => {
    render(<UseCasesView langfuseUrl="https://langfuse.example.com" />);
    const link = screen.getByTestId('langfuse-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://langfuse.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(link.textContent).toMatch(/Open in Langfuse/i);
  });

  it('omits the Langfuse link entirely when langfuseUrl is null', () => {
    render(<UseCasesView langfuseUrl={null} />);
    expect(screen.queryByTestId('langfuse-link')).toBeNull();
    expect(screen.queryByText(/Open in Langfuse/i)).toBeNull();
  });
});

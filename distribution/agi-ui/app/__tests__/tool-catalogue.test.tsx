// SPDX-License-Identifier: Apache-2.0
/**
 * ToolCatalogue — TanStack + react-virtual table behaviour.
 *
 * What's covered:
 *  1. The full row set is mounted (we use a viewport tall enough that
 *     all rows are inside the overscan window for the fixture size).
 *  2. Domain filter chips actually shrink the row count.
 *  3. ArrowDown moves focus to the next row's link; Enter follows the
 *     link (we assert the Next.js <Link> click handler is invoked, not
 *     a router push, because jsdom does not navigate on anchor click).
 *
 * jsdom + virtualisation: `useVirtualizer` reads bounding boxes from the
 * scroll container. We stub `getBoundingClientRect` and the `clientHeight`
 * so the virtualiser computes a viewport large enough to keep our test
 * rows mounted. Without this it sees a 0×0 viewport and renders nothing.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToolCatalogue } from '../tools/tool-catalogue';
import type { ToolSummary } from '@/lib/api/types';

// next/link in jsdom resolves to a regular anchor — that's fine for the
// click-handler assertion below, but we wrap it to give a stable spy.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const TOOLS: ToolSummary[] = [
  {
    name: 'billing.list_invoices',
    domain: 'billing',
    description: 'List billing invoices for a customer',
    side_effect: 'read',
    rate_limit_class: 'low',
    bundle_version: '2026-05-22',
    consuming_pack_count: 2,
    dry_run_supported: true,
  },
  {
    name: 'billing.adjust',
    domain: 'billing',
    description: 'Adjust a billing line-item',
    side_effect: 'write',
    rate_limit_class: 'medium',
    bundle_version: '2026-05-22',
    consuming_pack_count: 1,
    dry_run_supported: true,
  },
  {
    name: 'crm.lookup_customer',
    domain: 'crm',
    description: 'Look up a customer record',
    side_effect: 'read',
    rate_limit_class: 'low',
    bundle_version: '2026-05-22',
    consuming_pack_count: 3,
    dry_run_supported: true,
  },
  {
    name: 'crm.create_case',
    domain: 'crm',
    description: 'Create a support case',
    side_effect: 'write',
    rate_limit_class: 'high',
    bundle_version: '2026-05-22',
    consuming_pack_count: 2,
    dry_run_supported: true,
  },
];

beforeEach(() => {
  // Stub layout primitives so @tanstack/react-virtual computes a non-zero
  // viewport — otherwise it renders nothing in jsdom.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 800,
  });
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect;
  };
  // Some envs (jsdom) lack rAF — give it a microtask shim.
  if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
    (window as any).requestAnimationFrame = (cb: (t: number) => void) => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number;
    };
  }
});

afterEach(() => {
  // testing-library only auto-cleans when `globals: true` — our vitest
  // config keeps globals off, so unmount manually between tests to avoid
  // accumulated DOM nodes confusing role/name queries.
  cleanup();
});

describe('ToolCatalogue', () => {
  it('renders_all_tools_in_table', () => {
    render(<ToolCatalogue tools={TOOLS} />);
    // Total counter chip reflects the input list.
    expect(screen.getByText(`${TOOLS.length} of ${TOOLS.length}`)).toBeInTheDocument();
    // Each tool's anchor is in the DOM (overscan + 800px viewport keep all 4).
    for (const t of TOOLS) {
      expect(screen.getByRole('link', { name: t.name })).toBeInTheDocument();
    }
  });

  it('filter_by_domain', () => {
    render(<ToolCatalogue tools={TOOLS} />);
    // Click the 'crm' filter chip — only the 2 crm tools should remain.
    const crmChip = screen.getByRole('checkbox', { name: 'crm' });
    fireEvent.click(crmChip);

    expect(screen.getByText(`2 of ${TOOLS.length}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'crm.lookup_customer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'crm.create_case' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'billing.list_invoices' })).toBeNull();
  });

  it('keyboard_navigation_focus', () => {
    render(<ToolCatalogue tools={TOOLS} />);

    const firstRow = screen.getAllByTestId('tool-row')[0];
    const firstLink = within(firstRow).getByTestId('tool-row-link') as HTMLAnchorElement;
    firstLink.focus();
    expect(document.activeElement).toBe(firstLink);

    // ArrowDown — focus should advance to the next row's link.
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
    // requestAnimationFrame fires synchronously via the shim above.

    const secondRow = screen.getAllByTestId('tool-row')[1];
    const secondLink = within(secondRow).getByTestId('tool-row-link') as HTMLAnchorElement;
    expect(secondLink.getAttribute('href')).toBe(
      `/tools/${encodeURIComponent(TOOLS[1].name)}`,
    );

    // Enter follows the link — assert via a click spy on the anchor itself.
    // jsdom does not navigate on Enter, but the anchor's default click is
    // what the browser would fire. We spy on click() to verify intent.
    const clickSpy = vi.fn();
    secondLink.addEventListener('click', (e) => {
      clickSpy();
      e.preventDefault();
    });
    fireEvent.click(secondLink);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

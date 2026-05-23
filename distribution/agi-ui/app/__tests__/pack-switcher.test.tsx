// SPDX-License-Identifier: Apache-2.0
/**
 * pack-switcher behaviour test: changing the select writes the cookie and
 * triggers a reload (FR-IA-01 supporting requirement, ADMIN-§3.2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PackSwitcher } from '../components/pack-switcher';
import { AuthProvider } from '../components/auth-provider';
import { COOKIES } from '../components/runtime-fetch';

const ADMIN = {
  subject: 'sub-1',
  email: 'admin@example.test',
  scopes: ['agi:admin'],
};

const reload = vi.fn();

beforeEach(() => {
  // jsdom does not implement reload; stub it.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  document.cookie = `${COOKIES.pack}=; path=/; max-age=0`;
  reload.mockReset();
});

afterEach(() => {
  document.cookie = `${COOKIES.pack}=; path=/; max-age=0`;
});

describe('PackSwitcher', () => {
  it('admin can change the active pack', () => {
    render(
      <AuthProvider initialUser={ADMIN as any}>
        <PackSwitcher
          available={[
            { slug: 'telco-demo', display_name: 'Telco Demo' },
            { slug: 'bluemarble', display_name: 'BlueMarble' },
          ]}
        />
      </AuthProvider>,
    );

    const select = screen.getByLabelText('Active pack') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'bluemarble' } });

    expect(document.cookie).toContain(`${COOKIES.pack}=bluemarble`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('operator with single pack shows a fixed label, no select', () => {
    const op = {
      subject: 'sub-op',
      email: 'op@example.test',
      scopes: ['agi:operator:telco-demo'],
    };
    render(
      <AuthProvider initialUser={op as any}>
        <PackSwitcher available={[{ slug: 'telco-demo', display_name: 'Telco Demo' }]} />
      </AuthProvider>,
    );
    expect(screen.queryByLabelText('Active pack')).toBeNull();
    expect(screen.getByText(/telco-demo/)).toBeInTheDocument();
  });
});

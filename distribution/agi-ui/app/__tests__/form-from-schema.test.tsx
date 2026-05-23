// SPDX-License-Identifier: Apache-2.0
/**
 * FormFromSchema — rendering contract tests (FR-TOOL-02 AC).
 *
 * Covers the six schema shapes the bundle emits in v1:
 *   1. string + required → label has `*` and wrapper has data-required
 *   2. enum → <select>
 *   3. oneOf with discriminator → segmented control switches sub-form
 *   4. oneOf without discriminator → JSON textarea with parse validation
 *   5. array<primitive> → add/remove rows
 *   6. nested object → collapsible fieldset
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FormFromSchema } from '../components/form-from-schema';
import type { JsonSchema } from '@/lib/api/types';

afterEach(() => {
  cleanup();
});

function Harness({ schema, initial = {} }: { schema: JsonSchema; initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <FormFromSchema schema={schema} value={value} onChange={setValue} />
      <pre data-testid="state">{JSON.stringify(value)}</pre>
    </>
  );
}

describe('FormFromSchema', () => {
  it('renders_string_required_with_asterisk', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['account_id'],
      properties: {
        account_id: { type: 'string', description: 'TMF customer id' },
      },
    };
    render(<Harness schema={schema} />);
    const label = screen.getByText('account_id');
    // The asterisk is a sibling <span> in the same label container.
    expect(label.parentElement?.textContent).toContain('*');
    // The wrapper carries data-required for a11y/lint accessors.
    const input = screen.getByLabelText(/account_id/) as HTMLInputElement;
    const wrapper = input.closest('[data-required="true"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders_enum_as_select', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    };
    render(<Harness schema={schema} />);
    const select = screen.getByLabelText(/priority/) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(['', 'low', 'medium', 'high']);

    fireEvent.change(select, { target: { value: 'high' } });
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      priority: 'high',
    });
  });

  it('renders_oneOf_with_discriminator_as_segmented_control_switching_subforms', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        payload: {
          oneOf: [
            {
              title: 'sms',
              type: 'object',
              properties: {
                kind: { const: 'sms' },
                phone: { type: 'string' },
              },
              required: ['kind', 'phone'],
            },
            {
              title: 'email',
              type: 'object',
              properties: {
                kind: { const: 'email' },
                address: { type: 'string', format: 'email' },
              },
              required: ['kind', 'address'],
            },
          ],
          discriminator: { propertyName: 'kind' },
        },
      },
    };
    render(<Harness schema={schema} />);

    // Default branch is the first one — sms — so phone field is visible.
    expect(screen.getByLabelText(/phone/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/address/)).toBeNull();

    // The segmented control exposes both branch labels.
    const emailBtn = screen.getByRole('button', { name: 'email' });
    fireEvent.click(emailBtn);

    expect(screen.queryByLabelText(/phone/)).toBeNull();
    expect(screen.getByLabelText(/address/)).toBeInTheDocument();

    // The discriminator tag is reflected in state.
    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}');
    expect(state.payload.kind).toBe('email');
  });

  it('renders_oneOf_without_discriminator_as_json_textarea_with_parse_validation', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        freeform: {
          oneOf: [{ type: 'object' }, { type: 'array' }],
        },
      },
    };
    render(<Harness schema={schema} />);

    // The warning chip is visible.
    expect(screen.getByText(/free-form: validate manually/i)).toBeInTheDocument();

    const ta = screen.getByLabelText(/freeform/) as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');

    // Bad JSON → parse error rendered, state unchanged.
    fireEvent.change(ta, { target: { value: '{not-json' } });
    expect(screen.getByRole('alert').textContent).toMatch(/JSON parse error/);
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({});

    // Good JSON → onChange fires with the parsed object.
    fireEvent.change(ta, { target: { value: '{"a":1}' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      freeform: { a: 1 },
    });
  });

  it('renders_array_of_primitives_with_add_remove', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    render(<Harness schema={schema} />);

    fireEvent.click(screen.getByRole('button', { name: /add tags row/i }));
    fireEvent.click(screen.getByRole('button', { name: /add tags row/i }));
    expect(screen.getByTestId('array-row-tags-0')).toBeInTheDocument();
    expect(screen.getByTestId('array-row-tags-1')).toBeInTheDocument();

    // Type into the first row's input.
    const firstInput = screen.getByLabelText('tags[0]') as HTMLInputElement;
    fireEvent.change(firstInput, { target: { value: 'vip' } });
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      tags: ['vip', ''],
    });

    // Remove the second row.
    fireEvent.click(screen.getByRole('button', { name: /remove tags row 2/i }));
    expect(screen.queryByTestId('array-row-tags-1')).toBeNull();
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      tags: ['vip'],
    });
  });

  it('renders_nested_object_in_collapsible_fieldset', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        address: {
          type: 'object',
          description: 'Postal address',
          required: ['city'],
          properties: {
            city: { type: 'string' },
            postcode: { type: 'string' },
          },
        },
      },
    };
    render(<Harness schema={schema} />);

    // Fieldset exists and is collapsible (the legend has a toggle button).
    const toggle = screen.getByRole('button', { name: /address/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Nested fields are visible while expanded.
    const cityInput = screen.getByLabelText(/city/) as HTMLInputElement;
    fireEvent.change(cityInput, { target: { value: 'Pune' } });
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toEqual({
      address: { city: 'Pune' },
    });

    // Collapse hides the body.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText(/city/)).toBeNull();
  });
});

// Silence noisy `act` warnings for the controlled-onChange tests where state
// updates flow synchronously. The assertions above already wait on render.
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

// SPDX-License-Identifier: Apache-2.0
'use client';

/**
 * AuditFiltersForm — controlled form that updates the URL search params.
 * Filter changes do not reset scroll position because we push state via
 * router.replace (FR-TRAIL-01 AC).
 */

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { type AuditFilters, filtersToQuery } from './filters';

const EVENT_TYPES = [
  'tool_call',
  'tool_result',
  'llm_request',
  'llm_response',
  'handoff',
  'error',
  'kb_search',
  'kb_hit',
];

interface Props {
  initial: AuditFilters;
}

export function AuditFiltersForm({ initial }: Props) {
  const router = useRouter();
  const [pack, setPack] = useState(initial.pack ?? '');
  const [eventType, setEventType] = useState(initial.eventType ?? '');
  const [from, setFrom] = useState(initial.from?.slice(0, 16) ?? '');
  const [to, setTo] = useState(initial.to?.slice(0, 16) ?? '');

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const filters: AuditFilters = {
      pack: pack || null,
      eventType: eventType || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
    };
    router.replace(`/audit${filtersToQuery(filters)}`, { scroll: false });
  };

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-foreground/5 p-3"
    >
      <label className="flex flex-col gap-1 text-xs">
        Pack
        <Input
          value={pack}
          onChange={(e) => setPack(e.currentTarget.value)}
          placeholder="any"
          className="w-40"
          aria-label="Pack filter"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Event
        <Select
          value={eventType}
          onChange={(e) => setEventType(e.currentTarget.value)}
          className="w-44"
          aria-label="Event type filter"
        >
          <option value="">any</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        From
        <Input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
          className="w-52"
          aria-label="From timestamp"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        To
        <Input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
          className="w-52"
          aria-label="To timestamp"
        />
      </label>
      <Button type="submit" size="sm">
        Apply
      </Button>
    </form>
  );
}

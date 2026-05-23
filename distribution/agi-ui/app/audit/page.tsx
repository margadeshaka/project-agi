// SPDX-License-Identifier: Apache-2.0
'use client';

import { AuditList } from '../components/audit-list';
import { Icon, ScreenHead } from '../components/m3';

export default function AuditScreen() {
  return (
    <div className="stack">
      <ScreenHead
        title="AI-Trail"
        lede="Tamper-evident, append-only audit log. Separate from engineering traces (those live in Langfuse). Designed to be read by regulators."
        meta="last 24h · 15 events shown · stream lag <1s"
        right={
          <>
            <button type="button" className="btn text">
              <Icon name="filter" /> Saved filters
            </button>
            <a className="btn text" href="#">
              <Icon name="external" size={13} /> Open Langfuse
            </a>
          </>
        }
      />
      <AuditList />
    </div>
  );
}

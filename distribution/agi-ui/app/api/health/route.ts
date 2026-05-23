// SPDX-License-Identifier: Apache-2.0
/**
 * /api/health — thin proxy to the agi-runtime /healthz endpoint. The UI's
 * client-side health badge polls this so we don't need to expose the
 * runtime URL to the browser.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = process.env.AGI_RUNTIME_URL ?? 'http://localhost:9000';
  try {
    const res = await fetch(`${base}/healthz`, { cache: 'no-store' });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { status: 'unreachable', error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}

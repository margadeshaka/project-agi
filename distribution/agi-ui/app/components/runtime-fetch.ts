// SPDX-License-Identifier: Apache-2.0
/**
 * runtimeFetch — the SINGLE allowed entry point to the agi-runtime API.
 *
 * Why this exists (FR-INT-01, FR-INT-02, FR-AUTH-03):
 *  - Injects Authorization: Bearer <access token> from the session cookie.
 *  - Injects X-Pack from the pack-switcher cookie (FR-AUTH-03 — header
 *    is INFORMATIONAL only; the runtime decides scope from the JWT claim).
 *  - Normalises RFC 9457 problem-details into a thrown RuntimeError that
 *    components can render verbatim.
 *  - Centralises caching defaults so we don't accidentally cache mutations.
 *
 * Lint rule (scripts/check-no-hex.ts) ensures no raw fetch() in components.
 */

import type { ProblemDetails } from '@/lib/api/types';

const PACK_COOKIE = 'agi.pack';
const SESSION_COOKIE = 'agi.session';

export class RuntimeError extends Error {
  public readonly status: number;
  public readonly problem: ProblemDetails;
  constructor(status: number, problem: ProblemDetails) {
    super(problem.title ?? `HTTP ${status}`);
    this.name = 'RuntimeError';
    this.status = status;
    this.problem = problem;
  }
}

export interface RuntimeFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — serialised automatically with Content-Type. */
  json?: unknown;
  /** Multipart form body for KB upload. */
  form?: FormData;
  /** Override X-Pack from cookie (e.g. server components passing it through). */
  pack?: string | null;
  /** Bearer token override (server-side use). Browser path reads from session helper. */
  bearer?: string | null;
  /** Disable response JSON parse (e.g. SSE / streaming). */
  raw?: boolean;
}

/** Read a cookie value on either server or client. */
function readCookie(name: string): string | null {
  if (typeof document !== 'undefined') {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
  }
  return null;
}

function runtimeBase(): string {
  // Server: AGI_RUNTIME_URL. Client: NEXT_PUBLIC_AGI_RUNTIME_URL falls back
  // to same-origin reverse-proxy via /api/runtime/* (recommended in prod so
  // we don't leak the runtime origin to the browser).
  if (typeof window === 'undefined') {
    return process.env.AGI_RUNTIME_URL ?? 'http://localhost:9000';
  }
  return process.env.NEXT_PUBLIC_AGI_RUNTIME_URL ?? '/api/runtime';
}

/**
 * runtimeFetch — typed wrapper around the runtime.
 *
 * On 2xx: returns parsed JSON as T.
 * On non-2xx with problem-details: throws RuntimeError(problem).
 * On non-2xx without JSON: throws RuntimeError with a synthesised problem.
 * On network failure: throws RuntimeError(status=0).
 */
export async function runtimeFetch<T = unknown>(
  path: string,
  options: RuntimeFetchOptions = {},
): Promise<T> {
  const { json, form, pack, bearer, raw, headers: hdr, ...rest } = options;

  const headers = new Headers(hdr);

  // X-Pack header — best-effort; server validates against JWT claim anyway.
  const packHeader = pack ?? readCookie(PACK_COOKIE);
  if (packHeader) {
    headers.set('X-Pack', packHeader);
  }

  // Bearer auth — server-side path is explicit; browser path reads from
  // the httpOnly session cookie via a same-origin proxy (so the access token
  // never touches JavaScript). When NEXT_PUBLIC_AGI_RUNTIME_URL is unset
  // we hit /api/runtime/* and Next attaches the bearer there.
  const bearerToken = bearer ?? (typeof window === 'undefined' ? null : readCookie(SESSION_COOKIE));
  if (bearerToken) {
    headers.set('Authorization', `Bearer ${bearerToken}`);
  }

  let body: BodyInit | undefined;
  if (form) {
    body = form;
    // Don't set Content-Type — fetch sets the multipart boundary itself.
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const url = path.startsWith('http') ? path : `${runtimeBase()}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      body,
      // Default to no-store for mutations and dynamic reads; callers can
      // opt into cache by passing `cache: 'force-cache'`.
      cache: rest.cache ?? 'no-store',
    });
  } catch (err) {
    throw new RuntimeError(0, {
      title: 'Network error',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (raw) {
    if (!res.ok) {
      throw new RuntimeError(res.status, await parseProblem(res));
    }
    return res as unknown as T;
  }

  if (!res.ok) {
    throw new RuntimeError(res.status, await parseProblem(res));
  }

  // 204 No Content → return undefined cast as T.
  if (res.status === 204) {
    return undefined as T;
  }

  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/json') || ct.includes('+json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

async function parseProblem(res: Response): Promise<ProblemDetails> {
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/problem+json') || ct.includes('application/json')) {
    try {
      return (await res.json()) as ProblemDetails;
    } catch {
      // fall through
    }
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  return {
    title: `HTTP ${res.status}`,
    status: res.status,
    detail: text || res.statusText,
  };
}

/** Helper for client components: set the active pack cookie + soft reload. */
export function setActivePack(slug: string | null): void {
  if (typeof document === 'undefined') return;
  if (slug === null) {
    document.cookie = `${PACK_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } else {
    document.cookie = `${PACK_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=2592000; samesite=lax`;
  }
}

/** Read the currently active pack (browser only). */
export function readActivePack(): string | null {
  return readCookie(PACK_COOKIE);
}

/** Cookie name exports — keep the names in one place. */
export const COOKIES = {
  pack: PACK_COOKIE,
  session: SESSION_COOKIE,
};

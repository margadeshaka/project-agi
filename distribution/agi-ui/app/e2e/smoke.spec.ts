// SPDX-License-Identifier: Apache-2.0
/**
 * Smoke E2E — sign in, walk every top-level route, assert no 5xx.
 *
 * The runtime is mocked via Playwright route-fulfilment so this suite runs
 * deterministically in CI without spinning up agi-runtime.
 *
 * Run: `npx playwright test app/e2e/smoke.spec.ts`
 *
 * NOTE: Playwright config lives in playwright.config.ts at the repo root
 * (added by the P5 agent). For now this spec is self-describing: it
 * assumes baseURL=http://localhost:8080 and webServer launches `next dev`.
 */

import { test, expect, type Route } from '@playwright/test';

interface MockMap {
  [path: string]: { status: number; body: unknown } | ((route: Route) => Promise<void> | void);
}

const ADMIN_SESSION = {
  subject: 'admin-1',
  email: 'admin@example.test',
  scopes: ['agi:admin', 'agi:viewer', 'agi:dev'],
};

const MOCKS: MockMap = {
  '/admin/whoami': { status: 200, body: ADMIN_SESSION },
  '/admin/status': {
    status: 200,
    body: {
      status: 'ready',
      checks: { runtime: true, qdrant: true, langfuse: true },
      details: { runtime: { latency_ms: 12 } },
    },
  },
  '/healthz': { status: 200, body: { status: 'ready', checks: { runtime: true } } },
  '/admin/packs': {
    status: 200,
    body: [
      {
        slug: 'care-demo',
        display_name: 'Care Demo',
        vertical: 'telco',
        source_path: 'packs/care-demo',
        sha: 'abc123def456',
        tool_count: 8,
        kb_article_count: 12,
        kb_last_reindex_iso: '2026-05-22T13:00:00Z',
      },
    ],
  },
  '/admin/packs/care-demo': {
    status: 200,
    body: {
      slug: 'care-demo',
      display_name: 'Care Demo',
      vertical: 'telco',
      source_path: 'packs/care-demo',
      sha: 'abc123def456',
      theme: { primary: 'rgb(0 102 204)' },
      role_bindings: [],
      allowed_tools: [],
      recent_events_24h: { tool: 0, llm: 0, error: 0, handoff: 0 },
    },
  },
  '/admin/llm/bindings': { status: 200, body: [] },
  '/admin/use-cases': { status: 200, body: [] },
  '/admin/log': { status: 200, body: [] },
  '/admin/users': { status: 200, body: [] },
  '/admin/settings': {
    status: 200,
    body: { oidc_issuer: 'http://kc/', telemetry_sampling: 0.1, env: 'test' },
  },
  '/tools': { status: 200, body: [] },
  '/trail': { status: 200, body: [] },
  '/kb': { status: 200, body: [] },
};

test.beforeEach(async ({ context }) => {
  // Plant a fake session cookie so the layout treats us as authenticated.
  await context.addCookies([
    {
      name: 'agi.session',
      value: 'test-token',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  // Route every browser-side runtime call to a stub. Server-side calls go
  // through the runtime origin (AGI_RUNTIME_URL); the test harness sets
  // that to a non-routable address so server fetches fail-soft and pages
  // still render their error/empty states.
  await context.route('**/api/runtime/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/runtime', '').split('?')[0];
    const m = MOCKS[path];
    if (!m) {
      await route.fulfill({ status: 404, body: JSON.stringify({ title: 'no mock' }) });
      return;
    }
    if (typeof m === 'function') {
      await m(route);
      return;
    }
    await route.fulfill({
      status: m.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(m.body),
    });
  });
});

const ROUTES = ['/', '/packs', '/packs/care-demo/overview', '/tools', '/use-cases', '/audit', '/llm', '/admin/users', '/admin/log', '/admin/settings'];

for (const path of ROUTES) {
  test(`route ${path} renders without 5xx`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status() ?? 0).toBeLessThan(500);
    // h1 should be present on every authenticated page.
    await expect(page.locator('h1')).toBeVisible();
  });
}

test('sign-in page renders', async ({ page }) => {
  const response = await page.goto('/sign-in');
  expect(response?.status() ?? 0).toBeLessThan(500);
  await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible();
});

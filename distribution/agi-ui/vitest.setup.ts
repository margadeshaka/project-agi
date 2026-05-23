// SPDX-License-Identifier: Apache-2.0
import '@testing-library/jest-dom/vitest';

// Undici's fetch (Node) requires absolute URLs; jsdom.url affects document
// but not the global fetch. Give runtime-fetch an absolute base so tests can
// exercise the relative-path code path that prod uses.
process.env.NEXT_PUBLIC_AGI_RUNTIME_URL ??= 'http://localhost/api/runtime';

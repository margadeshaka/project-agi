// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Automatic JSX runtime so component tests don't need `import React` —
  // matches Next.js's prod SWC config.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    globals: false,
    include: [
      'app/__tests__/**/*.test.{ts,tsx}',
      'app/**/__tests__/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'app/e2e/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

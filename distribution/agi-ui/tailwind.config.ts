// SPDX-License-Identifier: Apache-2.0
import type { Config } from 'tailwindcss';

/**
 * Tailwind v4 config — CSS-variable based theming so packs can override
 * brand tokens without rebuilding the UI. Variables are declared in
 * app/globals.css.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--agi-bg) / <alpha-value>)',
        foreground: 'rgb(var(--agi-fg) / <alpha-value>)',
        muted: 'rgb(var(--agi-muted) / <alpha-value>)',
        accent: 'rgb(var(--agi-accent) / <alpha-value>)',
        border: 'rgb(var(--agi-border) / <alpha-value>)',
        success: 'rgb(var(--agi-success) / <alpha-value>)',
        warning: 'rgb(var(--agi-warning) / <alpha-value>)',
        danger: 'rgb(var(--agi-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

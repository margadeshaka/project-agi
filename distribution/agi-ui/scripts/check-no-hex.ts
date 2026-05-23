// SPDX-License-Identifier: Apache-2.0
/**
 * check-no-hex.ts — fail the build if any component file contains a hex
 * colour literal outside the allowed token definition files.
 *
 * Enforces NFR-THM-01 ("No hex literals in components").
 *
 * Run: `node --import tsx scripts/check-no-hex.ts` (or via npm run lint:no-hex).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Files where hex literals are allowed (token definitions, generated css). */
const ALLOWLIST: RegExp[] = [
  /^app[\\/]globals\.css$/,
  /^app[\\/]styles[\\/]/,
  /\.css$/,
  // The pack overview surfaces a hex value as DATA (props from the runtime).
  // The component itself doesn't hard-code a hex; we ignore those usages by
  // matching the file plus an inline comment marker if needed.
];

/** File extensions that participate in the lint. */
const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

/** Anything under these dirs is skipped (build output, deps, tests). */
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', '.git', 'playwright-report', 'test-results']);

/** Allow named-color literals (white, black, red); we only block `#xxxxxx` / `#xxx`. */
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (EXTS.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function isAllowed(rel: string): boolean {
  const normalised = rel.split(sep).join('/');
  return ALLOWLIST.some((p) => p.test(normalised));
}

function main(): void {
  const violations: Array<{ file: string; line: number; preview: string }> = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file);
    if (isAllowed(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Don't trip on comments mentioning a hex (false positives in docstrings).
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (HEX_RE.test(line)) {
        violations.push({ file: rel, line: i + 1, preview: line.trim() });
      }
    }
  }
  if (violations.length > 0) {
    console.error(`\n  check-no-hex: ${violations.length} violation(s) found:\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.preview}`);
    }
    console.error(
      '\n  Components must consume CSS variables (e.g. rgb(var(--agi-accent))) — see NFR-THM-01.\n',
    );
    process.exit(1);
  }
  console.log('check-no-hex: clean.');
}

main();

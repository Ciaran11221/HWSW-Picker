// Fails when a folder under packages/ has no row in the CLAUDE.md "Repo map" table,
// so the map cannot silently go stale.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Returns the `packages/<name>` paths listed in the "## Repo map" table of CLAUDE.md.
 * A row counts when it starts with: | `packages/<name>` |
 */
export function repoMapPackagePaths(claudeMd: string): string[] {
  const lines = claudeMd.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Repo map\s*$/.test(line));
  if (start < 0) throw new Error('CLAUDE.md has no "## Repo map" section');
  const found: string[] = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const m = /^\|\s*`(packages\/[^`/]+)`\s*\|/.exec(lines[i]);
    if (m) found.push(m[1]);
  }
  return found;
}

describe('repo map (CLAUDE.md)', () => {
  it('parses the packages rows from the Repo map table', () => {
    const rows = repoMapPackagePaths(readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'));
    expect(rows).toEqual(expect.arrayContaining(['packages/core', 'packages/pipeline']));
  });

  it('has a row for every folder under packages/', () => {
    const rows = new Set(repoMapPackagePaths(readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')));
    const folders = readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `packages/${d.name}`)
      .sort();
    const missing = folders.filter((f) => !rows.has(f));
    expect(missing, `no Repo map row in CLAUDE.md for: ${missing.join(', ')}`).toEqual([]);
  });
});

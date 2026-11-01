// Mistakes corpus checks: every entry is valid and named <id>.json, every guard names a
// test file that exists and contains the test name, and corpus/mistakes/INDEX.md is up to date.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MISTAKES_DIR,
  MISTAKES_INDEX_PATH,
  guardProblem,
  loadMistakes,
  renderMistakesIndex,
  validateMistake,
} from '../scripts/mistakes-corpus';

function entryFiles(): string[] {
  return readdirSync(MISTAKES_DIR).filter((f) => f.endsWith('.json')).sort();
}

const normalise = (s: string) => s.replace(/\r\n/g, '\n');

describe('corpus/mistakes', () => {
  it('has at least one entry', () => {
    expect(entryFiles().length).toBeGreaterThan(0);
  });

  it('every entry is valid and named <id>.json', () => {
    const errors: string[] = [];
    for (const file of entryFiles()) {
      try {
        validateMistake(JSON.parse(readFileSync(path.join(MISTAKES_DIR, file), 'utf8')), file);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    expect(errors).toEqual([]);
  });

  it('every guard names an existing test file that contains the exact test name', () => {
    const problems = loadMistakes(MISTAKES_DIR)
      .map((m) => guardProblem(m))
      .filter((p): p is string => p !== null);
    expect(problems, problems.join('; ')).toEqual([]);
  });

  it('corpus/mistakes/INDEX.md matches renderMistakesIndex() of the current entries (run npm run corpus:index)', () => {
    const expected = renderMistakesIndex(loadMistakes(MISTAKES_DIR));
    const actual = readFileSync(MISTAKES_INDEX_PATH, 'utf8');
    expect(normalise(actual)).toBe(normalise(expected));
  });
});

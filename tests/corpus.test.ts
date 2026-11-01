// Corpus checks: every family file is valid, named after its id, no tag sits in two
// families (that would double-count the %), and corpus/INDEX.md is up to date.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFamily, type Family } from '@hwsw/core';
import { FAMILIES_DIR, INDEX_PATH, loadFamilies, renderIndex } from '../scripts/corpus-index';

function familyFiles(): string[] {
  return readdirSync(FAMILIES_DIR).filter((f) => f.endsWith('.json')).sort();
}

const normalise = (s: string) => s.replace(/\r\n/g, '\n');

describe('corpus/families', () => {
  it('has at least one family file', () => {
    expect(familyFiles().length).toBeGreaterThan(0);
  });

  it('every family file parses with parseFamily', () => {
    const errors: string[] = [];
    for (const file of familyFiles()) {
      try {
        parseFamily(JSON.parse(readFileSync(path.join(FAMILIES_DIR, file), 'utf8')));
      } catch (err) {
        errors.push(`${file}: ${(err as Error).message}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it('every family file is named <id>.json', () => {
    const mismatched: string[] = [];
    for (const file of familyFiles()) {
      const family = parseFamily(JSON.parse(readFileSync(path.join(FAMILIES_DIR, file), 'utf8')));
      if (file !== `${family.id}.json`) mismatched.push(`${file} has id "${family.id}"`);
    }
    expect(mismatched).toEqual([]);
  });

  it('no member tag appears in two families (or twice in one)', () => {
    const families: Family[] = loadFamilies(FAMILIES_DIR);
    const owners = new Map<string, string[]>();
    for (const f of families) {
      for (const tag of f.members) {
        owners.set(tag, [...(owners.get(tag) ?? []), f.id]);
      }
    }
    const dupes = [...owners.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([tag, ids]) => `${tag} in ${ids.join(', ')}`);
    expect(dupes, `tags in more than one family: ${dupes.join('; ')}`).toEqual([]);
  });

  it('corpus/INDEX.md matches renderIndex() of the current families (run npm run corpus:index)', () => {
    const expected = renderIndex(loadFamilies(FAMILIES_DIR));
    const actual = readFileSync(INDEX_PATH, 'utf8');
    expect(normalise(actual)).toBe(normalise(expected));
  });
});

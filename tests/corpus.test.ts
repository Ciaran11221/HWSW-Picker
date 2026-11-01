// Corpus checks: every family file is valid, named after its id, no tag sits in two
// families (that would double-count the %), corpus/INDEX.md is up to date, and the
// endoflife.date snapshot agrees with families that have eol=null (guard for the
// "eol id guessed from package name" mistake in corpus/mistakes).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFamily, type Family } from '@hwsw/core';
import { FAMILIES_DIR, INDEX_PATH, loadFamilies, renderIndex } from '../scripts/corpus-index';
import { EOL_SNAPSHOT_PATH, loadEolSnapshot, purlToTagId } from '../scripts/eol-snapshot';

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

describe('corpus/eol-products.json', () => {
  it('lists each product once, sorted by id, with at least one purl', () => {
    const products = loadEolSnapshot(EOL_SNAPSHOT_PATH);
    const ids = products.map((p) => p.id);
    const bad = products.filter((p) => p.purls.length === 0).map((p) => p.id);
    expect(bad, `products with no purl: ${bad.join(', ')}`).toEqual([]);
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('purlToTagId maps package URLs to tag ids and returns null for other ecosystems', () => {
    expect(purlToTagId('pkg:npm/%40types/node')).toBe('npm:@types/node');
    expect(purlToTagId('pkg:npm/next@14.2.0')).toBe('npm:next');
    expect(purlToTagId('pkg:docker/library/node')).toBe('docker:node');
    expect(purlToTagId('pkg:docker/circleci/node')).toBe('docker:circleci/node');
    expect(purlToTagId('pkg:pypi/numpy')).toBe('pypi:numpy');
    expect(purlToTagId('pkg:golang/github.com/gin-gonic/gin')).toBe('go:github.com/gin-gonic/gin');
    expect(purlToTagId('pkg:maven/org.springframework.boot/spring-boot')).toBe('maven:org.springframework.boot:spring-boot');
    expect(purlToTagId('pkg:github/vercel/next.js')).toBeNull();
    expect(purlToTagId('pkg:generic/node')).toBeNull();
  });

  it('no family with eol=null has an endoflife.date product whose package URL maps to one of its members', () => {
    const families = loadFamilies(FAMILIES_DIR);
    const products = loadEolSnapshot(EOL_SNAPSHOT_PATH);
    const problems: string[] = [];
    for (const f of families) {
      if (f.eol !== null) continue;
      const members = new Set<string>(f.members);
      for (const p of products) {
        for (const purl of p.purls) {
          const tag = purlToTagId(purl);
          if (tag !== null && members.has(tag)) {
            problems.push(`family ${f.id} has eol=null but endoflife.date product "${p.id}" lists ${purl} (= ${tag})`);
          }
        }
      }
    }
    expect(problems, problems.join('; ')).toEqual([]);
  });
});

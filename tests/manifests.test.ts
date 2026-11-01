// Golden-fixture guardrail for the manifest parsers. Every fixture in corpus/manifests/ must
// parse to exactly its .expected.json, every format needs >= 3 fixtures (one with errors),
// and no parser may throw on garbage. Change an expected file only through
// `npm run fixtures:update`, then read the diff.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTagId } from '@hwsw/core';
import { MANIFEST_FORMATS, detectFormat, parseManifest } from '../packages/pipeline/src/parsers/index';
import { MANIFESTS_DIR, listFixtures, readInput } from '../packages/pipeline/src/fixtures';

const fixtures = listFixtures();

describe('manifest fixtures', () => {
  it('finds fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('only has folders named after a known format', () => {
    const dirs = readdirSync(MANIFESTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.filter((d) => !(MANIFEST_FORMATS as readonly string[]).includes(d))).toEqual([]);
  });

  it.each(fixtures.map((f) => [`${f.format}/${f.caseName}`, f] as const))('%s output equals its .expected.json', (_name, f) => {
    expect(existsSync(f.expectedPath), `missing ${path.basename(f.expectedPath)}; run npm run fixtures:update and review it`).toBe(true);
    const expected = JSON.parse(readFileSync(f.expectedPath, 'utf8'));
    expect(parseManifest(f.fileName, readInput(f))).toEqual(expected);
  });

  it.each(fixtures.map((f) => [`${f.format}/${f.caseName}`, f] as const))('%s is routed to its own format and yields valid tags', (_name, f) => {
    expect(detectFormat(f.fileName)).toBe(f.format);
    const result = parseManifest(f.fileName, readInput(f));
    for (const t of result.tags) expect(isTagId(t.tag), t.tag).toBe(true);
    for (const e of result.errors) {
      expect(e.kind).toBe('parse');
      expect(e.file).toBe(f.fileName);
    }
    expect(new Set(result.tags.map((t) => t.tag)).size).toBe(result.tags.length);
  });

  it.each(fixtures.map((f) => [`${f.format}/${f.caseName}`, f] as const))('%s gives the same output with CRLF line endings', (_name, f) => {
    const lf = readInput(f).replace(/\r\n/g, '\n');
    expect(parseManifest(f.fileName, lf.replace(/\n/g, '\r\n'))).toEqual(parseManifest(f.fileName, lf));
  });

  it('has no .expected.json without an input fixture', () => {
    const inputs = new Set(fixtures.map((f) => `${f.format}/${f.caseName}`));
    const orphans: string[] = [];
    for (const format of readdirSync(MANIFESTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      for (const base of readdirSync(path.join(MANIFESTS_DIR, format))) {
        const m = /^(.+)\.expected\.json$/.exec(base);
        if (m && !inputs.has(`${format}/${m[1]}`)) orphans.push(`${format}/${base}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it.each([...MANIFEST_FORMATS])('%s has >= 3 fixtures, at least one with errors', (format) => {
    const own = fixtures.filter((f) => f.format === format);
    expect(own.length, `${format} needs >= 3 fixtures in corpus/manifests/${format}/`).toBeGreaterThanOrEqual(3);
    const withErrors = own.filter((f) => parseManifest(f.fileName, readInput(f)).errors.length > 0);
    expect(withErrors.length, `${format} needs a malformed fixture whose output has errors`).toBeGreaterThanOrEqual(1);
  });
});

/** Small seeded PRNG (mulberry32) so fuzz inputs are the same on every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function garbage(seed: number): string {
  const r = rng(seed);
  const alphabet = '{}[]()<>"\'\\/:;,.=-_+*~^$@#!%&|\n\r\t \u0000\u0001ÿ﻿ abcXYZ019 gemFROMservicesimagerequireimplementation';
  const len = Math.floor(r() * 400);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}

describe('parseManifest never throws', () => {
  const names = [
    'package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'Dockerfile', 'docker-compose.yml',
  ];
  const inputs = [
    '', ' ', '\n\n', '\u0000\u0000', '{', '}', '[', '"', '<', '<<<<', '(((((', 'require (', 'FROM', 'services:', 'gem',
    'x'.repeat(200_000), '\n'.repeat(50_000), '{"dependencies":'.repeat(2000), '['.repeat(5000),
    '{"dependencies": null, "devDependencies": 5, "require": [], "require-dev": "x"}',
    ...Array.from({ length: 12 }, (_, i) => garbage(i + 1)),
  ];

  it.each(names)('%s survives garbage', (name) => {
    for (const input of inputs) {
      const result = parseManifest(name, input);
      expect(Array.isArray(result.tags)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      for (const e of result.errors) expect(e.kind).toBe('parse');
    }
  });

  it('survives non-string content and odd file names', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      const result = parseManifest('package.json', bad as unknown as string);
      expect(result.tags).toEqual([]);
      expect(result.errors).toHaveLength(1);
    }
    expect(parseManifest(undefined as unknown as string, 'x')).toEqual({ tags: [], errors: [] });
  });
});

describe('parseManifest dispatch', () => {
  it('gives an empty result, no error, for unknown files', () => {
    expect(parseManifest('README.md', '# hi')).toEqual({ tags: [], errors: [] });
    expect(parseManifest('package-lock.json', '{}')).toEqual({ tags: [], errors: [] });
  });

  it.each([
    ['package.json', 'package-json'],
    ['apps/web/package.json', 'package-json'],
    ['apps\\web\\PACKAGE.JSON', 'package-json'],
    ['Dockerfile', 'dockerfile'],
    ['dockerfile', 'dockerfile'],
    ['DOCKERFILE', 'dockerfile'],
    ['Dockerfile.dev', 'dockerfile'],
    ['docker/Dockerfile.Prod', 'dockerfile'],
    ['docker-compose.yml', 'docker-compose'],
    ['docker-compose.yaml', 'docker-compose'],
    ['compose.yml', 'docker-compose'],
    ['compose.yaml', 'docker-compose'],
    ['build.gradle', 'gradle'],
    ['build.gradle.kts', 'gradle'],
    ['cargo.toml', 'cargo-toml'],
    ['MyDockerfile', null],
    ['dockerfiles.txt', null],
  ])('detects %s as %s', (name, format) => {
    expect(detectFormat(name)).toBe(format);
  });

  it('keeps the first of a tag that appears twice, without an error', () => {
    const r = parseManifest('package.json', '{"dependencies":{"react":"^17.0.0"},"devDependencies":{"react":"^18.0.0"}}');
    expect(r).toEqual({ tags: [{ tag: 'npm:react', spec: '^17.0.0', version: '17.0.0', dev: false }], errors: [] });
  });

  it('keeps a docker image whose tag is only a variable, with version null', () => {
    const r = parseManifest('Dockerfile', 'FROM node:${NODE_VERSION}-alpine\n');
    expect(r).toEqual({ tags: [{ tag: 'docker:node', spec: '${NODE_VERSION}-alpine', version: null, dev: false }], errors: [] });
  });

  it('fills in a version from a later duplicate when the first had none', () => {
    const r = parseManifest('Dockerfile', 'FROM node:${V} AS build\nFROM node:20-slim\n');
    expect(r.tags).toEqual([{ tag: 'docker:node', spec: '20-slim', version: '20', dev: false }]);
  });

  it('labels errors with the file name it was given', () => {
    const r = parseManifest('apps/web/package.json', '{');
    expect(r.errors[0].file).toBe('apps/web/package.json');
  });

  it('strips a UTF-8 byte order mark', () => {
    const r = parseManifest('package.json', '﻿{"dependencies":{"a":"1.0.0"}}');
    expect(r.errors).toEqual([]);
    expect(r.tags.map((t) => t.tag)).toEqual(['npm:a']);
  });
});

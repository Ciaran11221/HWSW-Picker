// Writes corpus/eol-products.json: the endoflife.date products that have at least one
// package URL (purl), as [{id, purls}] sorted by id.
// Source: the raw /api/v1/products/full output (git-ignored, not in the repo). Pass its path:
//   npm run eol:snapshot -- <path to eol_full.json>
// endoflife.date data is MIT-licensed.
//
// purlToTagId is pure so the corpus test can map package URLs to tag ids without the raw file.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTagId, type TagId } from '@hwsw/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EOL_SNAPSHOT_PATH = path.join(ROOT, 'corpus', 'eol-products.json');

export interface EolProduct {
  /** endoflife.date product id (the product `name`). */
  id: string;
  /** Every purl identifier of the product, e.g. `pkg:npm/next`. */
  purls: string[];
}

/**
 * Maps a package URL to a tag id: pkg:npm/%40types/node -> npm:@types/node,
 * pkg:docker/library/node -> docker:node, pkg:pypi/numpy -> pypi:numpy.
 * Version (`@x`) and qualifiers (`?...`, `#...`) are dropped. Returns null when the
 * result is not a tag id (e.g. pkg:github/..., pkg:generic/...).
 */
export function purlToTagId(purl: string): TagId | null {
  const m = /^pkg:([a-z]+)\/(.+)$/i.exec(purl);
  if (m === null) return null;
  const type = m[1].toLowerCase();
  const withoutQualifiers = m[2].split(/[?#]/)[0];
  // A raw "@" is the version separator: scoped names are %40-encoded in purls.
  const withoutVersion = withoutQualifiers.replace(/@[^/]*$/, '');
  let name: string;
  try {
    name = decodeURIComponent(withoutVersion);
  } catch {
    return null;
  }
  if (type === 'docker') name = name.replace(/^library\//, '');
  // Our maven tags are group:artifact; purls write group/artifact.
  if (type === 'maven') name = name.replace('/', ':');
  // purl calls the Go ecosystem "golang"; our tags call it "go".
  const ecosystem = type === 'golang' ? 'go' : type;
  const tag = `${ecosystem}:${name}`.toLowerCase();
  return isTagId(tag) ? tag : null;
}

/** Keeps products with at least one purl, sorted by id. Throws on a malformed or duplicate entry. */
export function snapshotFromFull(full: unknown): EolProduct[] {
  const result = (full as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) throw new Error('source has no "result" array');
  const seen = new Set<string>();
  const out: EolProduct[] = [];
  for (const p of result as { name?: unknown; identifiers?: unknown }[]) {
    if (typeof p.name !== 'string' || p.name === '') throw new Error(`product without a name: ${JSON.stringify(p).slice(0, 80)}`);
    if (seen.has(p.name)) throw new Error(`duplicate product name "${p.name}"`);
    seen.add(p.name);
    const identifiers = Array.isArray(p.identifiers) ? (p.identifiers as { type?: unknown; id?: unknown }[]) : [];
    const purls = identifiers
      .filter((i) => i.type === 'purl' && typeof i.id === 'string')
      .map((i) => i.id as string);
    if (purls.length > 0) out.push({ id: p.name, purls });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Reads corpus/eol-products.json. */
export function loadEolSnapshot(file: string = EOL_SNAPSHOT_PATH): EolProduct[] {
  return JSON.parse(readFileSync(file, 'utf8')) as EolProduct[];
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const norm = (p: string) => path.resolve(p).toLowerCase();
  return norm(entry) === norm(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error('Usage: npm run eol:snapshot -- <path to eol_full.json>');
    process.exit(1);
  }
  const products = snapshotFromFull(JSON.parse(readFileSync(source, 'utf8')));
  writeFileSync(EOL_SNAPSHOT_PATH, JSON.stringify(products, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(ROOT, EOL_SNAPSHOT_PATH)} (${products.length} products with a purl)`);
}

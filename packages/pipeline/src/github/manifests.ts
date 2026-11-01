// Fetches the manifest files of many repos with GraphQL, in two steps:
//   1. Tree query: the root tree, plus one level down for `apps/*` and `packages/*`
//      (their sub-folders) and `frontend/`, `backend/`. File names are matched with
//      `detectFormat` to pick the manifests worth reading.
//   2. Blob query: the text of those files (`... on Blob { text isTruncated isBinary }`).
//
// Batching: 12 repos per query (25+ timed out with HTTP 502 in the spike). A transient
// failure (502, timeout) splits the batch in half and tries each half; a single repo that
// still fails twice gets a 'fetch' error. A truncated or binary blob gets a 'parse' error
// and is skipped. Nothing here throws except RunAborted from the client.

import type { PipelineError } from '@hwsw/core';
import { detectFormat } from '../parsers/index';
import type { GitHubClient, GraphqlError } from './client';

export interface ManifestFile {
  /** Path inside the repo, e.g. `package.json` or `apps/web/package.json`. */
  path: string;
  content: string;
}

export interface RepoManifests {
  fullName: string;
  files: ManifestFile[];
  errors: PipelineError[];
  /** File and folder names in the repo root, kept to explain repos that yield no tags. */
  rootNames: string[];
}

export interface ManifestOptions {
  /** Repos per GraphQL query. Default 12. */
  batchSize?: number;
  /** Most manifest files read per repo (root first). Default 12. */
  maxFilesPerRepo?: number;
  /** Most blobs in one blob query. Default 60. */
  maxBlobsPerQuery?: number;
}

const NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** Folders whose children are searched one level down: apps/<x>/<file>. */
const NESTED_DIRS = ['apps', 'packages'] as const;
/** Folders searched directly: frontend/<file>. */
const FLAT_DIRS = ['frontend', 'backend'] as const;

interface Entry {
  name?: unknown;
  type?: unknown;
  object?: { entries?: unknown } | null;
}

const asEntries = (tree: unknown): Entry[] => {
  const e = (tree as { entries?: unknown } | null | undefined)?.entries;
  return Array.isArray(e) ? (e as Entry[]) : [];
};

const isBlob = (e: Entry): e is Entry & { name: string } => e.type === 'blob' && typeof e.name === 'string';
const isTree = (e: Entry): e is Entry & { name: string } => e.type === 'tree' && typeof e.name === 'string';

function treeQuery(alias: string, fullName: string): string {
  const [owner, name] = fullName.split('/');
  const head = `${alias}: repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) {`;
  const root = 'root: object(expression:"HEAD:"){... on Tree{entries{name type}}}';
  const nested = NESTED_DIRS.map(
    (d) => `${d}: object(expression:"HEAD:${d}"){... on Tree{entries{name type object{... on Tree{entries{name type}}}}}}`,
  );
  const flat = FLAT_DIRS.map((d) => `${d}: object(expression:"HEAD:${d}"){... on Tree{entries{name type}}}`);
  return `${head} ${[root, ...nested, ...flat].join(' ')} }`;
}

function blobQuery(alias: string, fullName: string, paths: string[]): string {
  const [owner, name] = fullName.split('/');
  const files = paths.map(
    (p, i) => `f${i}: object(expression:${JSON.stringify(`HEAD:${p}`)}){... on Blob{isTruncated isBinary text}}`,
  );
  return `${alias}: repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) { ${files.join(' ')} }`;
}

/** Why a repo alias came back null, from the GraphQL errors list. */
function aliasError(errors: GraphqlError[], alias: string): string {
  const e = errors.find((x) => x.path?.[0] === alias);
  return e?.message ?? 'repository not found or not accessible';
}

/** Which manifest files to read, in reading order: root, then apps, packages, frontend, backend. */
export function pickManifestPaths(data: Record<string, unknown>): { rootNames: string[]; paths: string[] } {
  const rootEntries = asEntries(data.root);
  const rootNames = rootEntries.filter((e): e is Entry & { name: string } => typeof e.name === 'string').map((e) => e.name);
  const paths: string[] = [];
  for (const e of rootEntries) if (isBlob(e) && detectFormat(e.name) !== null) paths.push(e.name);
  for (const dir of NESTED_DIRS) {
    for (const sub of asEntries(data[dir]).filter(isTree)) {
      for (const f of asEntries(sub.object).filter(isBlob)) {
        if (detectFormat(f.name) !== null) paths.push(`${dir}/${sub.name}/${f.name}`);
      }
    }
  }
  for (const dir of FLAT_DIRS) {
    for (const f of asEntries(data[dir]).filter(isBlob)) {
      if (detectFormat(f.name) !== null) paths.push(`${dir}/${f.name}`);
    }
  }
  return { rootNames, paths };
}

type Outcome = null | { transient: boolean; message: string };

/**
 * Runs `call` on a batch. On a transient failure the batch is split in half and each half
 * is tried; a single item gets one more try, then `fail`. A non-transient failure fails the
 * whole batch at once.
 */
async function runBatch<T>(
  batch: T[],
  call: (b: T[]) => Promise<Outcome>,
  fail: (item: T, message: string) => void,
): Promise<void> {
  const out = await call(batch);
  if (out === null) return;
  if (!out.transient) {
    for (const item of batch) fail(item, out.message);
    return;
  }
  if (batch.length > 1) {
    const mid = Math.ceil(batch.length / 2);
    await runBatch(batch.slice(0, mid), call, fail);
    await runBatch(batch.slice(mid), call, fail);
    return;
  }
  const again = await call(batch);
  if (again !== null) fail(batch[0], `${again.message} (after one retry)`);
}

/** Groups items into chunks of at most `size` items and `maxWeight` total weight. */
function chunk<T>(items: T[], size: number, weight: (t: T) => number, maxWeight: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let w = 0;
  for (const it of items) {
    if (cur.length > 0 && (cur.length >= size || w + weight(it) > maxWeight)) {
      out.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(it);
    w += weight(it);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Fetches the manifest files of each repo (`owner/name`). Always returns one entry per input. */
export async function fetchManifests(
  client: GitHubClient,
  fullNames: string[],
  opts: ManifestOptions = {},
): Promise<Map<string, RepoManifests>> {
  const batchSize = opts.batchSize ?? 12;
  const maxFiles = opts.maxFilesPerRepo ?? 12;
  const maxBlobs = opts.maxBlobsPerQuery ?? 60;
  const result = new Map<string, RepoManifests>();
  const valid: string[] = [];
  for (const fullName of fullNames) {
    const entry: RepoManifests = { fullName, files: [], errors: [], rootNames: [] };
    result.set(fullName, entry);
    if (NAME_RE.test(fullName)) valid.push(fullName);
    else entry.errors.push({ kind: 'fetch', message: 'repo name is not owner/name', repo: fullName });
  }
  const failRepo = (fullName: string, message: string) => {
    result.get(fullName)?.errors.push({ kind: 'fetch', message, repo: fullName });
  };

  // Step 1: trees.
  const pathsByRepo = new Map<string, string[]>();
  const treeCall = async (batch: string[]): Promise<Outcome> => {
    const aliases = batch.map((_, i) => `r${i}`);
    const query = `query { ${batch.map((n, i) => treeQuery(aliases[i], n)).join(' ')} }`;
    const res = await client.graphql(query);
    if (!res.ok) return { transient: res.transient, message: res.message };
    batch.forEach((fullName, i) => {
      const repo = res.data[aliases[i]];
      if (repo === null || typeof repo !== 'object') {
        failRepo(fullName, aliasError(res.errors, aliases[i]));
        return;
      }
      const { rootNames, paths } = pickManifestPaths(repo as Record<string, unknown>);
      const entry = result.get(fullName)!;
      entry.rootNames = rootNames;
      pathsByRepo.set(fullName, paths.slice(0, maxFiles));
    });
    return null;
  };
  for (let i = 0; i < valid.length; i += batchSize) {
    await runBatch(valid.slice(i, i + batchSize), treeCall, failRepo);
  }

  // Step 2: blobs.
  const withFiles = [...pathsByRepo.entries()].filter(([, p]) => p.length > 0).map(([fullName, paths]) => ({ fullName, paths }));
  const blobCall = async (batch: { fullName: string; paths: string[] }[]): Promise<Outcome> => {
    const aliases = batch.map((_, i) => `r${i}`);
    const query = `query { ${batch.map((b, i) => blobQuery(aliases[i], b.fullName, b.paths)).join(' ')} }`;
    const res = await client.graphql(query);
    if (!res.ok) return { transient: res.transient, message: res.message };
    batch.forEach(({ fullName, paths }, i) => {
      const repo = res.data[aliases[i]] as Record<string, unknown> | null;
      const entry = result.get(fullName)!;
      if (repo === null || typeof repo !== 'object') {
        failRepo(fullName, aliasError(res.errors, aliases[i]));
        return;
      }
      paths.forEach((path, j) => {
        const blob = repo[`f${j}`] as { text?: unknown; isTruncated?: unknown; isBinary?: unknown } | null | undefined;
        if (blob === null || blob === undefined || typeof blob !== 'object') {
          entry.errors.push({ kind: 'fetch', message: 'manifest file listed in the tree but not returned', repo: fullName, file: path });
        } else if (blob.isTruncated === true) {
          entry.errors.push({ kind: 'parse', message: 'manifest is truncated by GitHub (too large); skipped', repo: fullName, file: path });
        } else if (blob.isBinary === true || typeof blob.text !== 'string') {
          entry.errors.push({ kind: 'parse', message: 'manifest is binary or has no text; skipped', repo: fullName, file: path });
        } else {
          entry.files.push({ path, content: blob.text });
        }
      });
    });
    return null;
  };
  const blobFail = (item: { fullName: string }, message: string) => failRepo(item.fullName, message);
  for (const group of chunk(withFiles, batchSize, (r) => r.paths.length, maxBlobs)) {
    await runBatch(group, blobCall, blobFail);
  }
  return result;
}

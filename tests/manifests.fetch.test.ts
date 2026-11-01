// Manifest fetching over GraphQL: picking paths from a tree, batches of 12, split-and-retry
// on 502, truncated / binary / missing blobs, and per-repo failures.

import { describe, expect, it } from 'vitest';
import { fetchManifests, pickManifestPaths } from '../packages/pipeline/src/github/manifests';
import {
  empty, fixture, graphqlResponse, isTreeQuery, json, makeClient, queryRepos, type FakeBlob,
} from './helpers/fakeGithub';

const tree = fixture<Record<string, unknown>>('tree-react-app.json');
const blobs = fixture<Record<string, FakeBlob>>('blobs-react-app.json');

/** A fake GraphQL endpoint backed by the fixtures. Records every query. */
function graphqlServer(
  perRepo: Parameters<typeof graphqlResponse>[3] = {},
  gate: (query: string) => Response | null = () => null,
) {
  const queries: string[] = [];
  const fetchFn = async (_url: string, init?: RequestInit) => {
    const body = String(init?.body);
    const query = (JSON.parse(body) as { query: string }).query;
    queries.push(query);
    return gate(query) ?? graphqlResponse(body, tree, blobs, perRepo);
  };
  return { fetchFn, queries };
}

describe('pickManifestPaths', () => {
  it('picks root, apps/*, packages/*, frontend/ and backend/ manifests in that order', () => {
    expect(pickManifestPaths(tree)).toEqual({
      rootNames: ['package.json', 'README.md', 'Dockerfile', 'src'],
      paths: ['package.json', 'Dockerfile', 'apps/web/package.json', 'frontend/package.json', 'backend/requirements.txt'],
    });
  });

  it('copes with missing trees, odd entries and a missing root', () => {
    expect(pickManifestPaths({})).toEqual({ rootNames: [], paths: [] });
    expect(pickManifestPaths({ root: { entries: [{ type: 'blob' }, { name: 5, type: 'blob' }] }, apps: { entries: 'x' } })).toEqual({
      rootNames: [],
      paths: [],
    });
  });
});

describe('fetchManifests', () => {
  it('fetches the files of a repo and gives truncated ones a parse error', async () => {
    const { fetchFn, queries } = graphqlServer();
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['acme/shiny']);
    const repo = out.get('acme/shiny')!;
    expect(repo.files.map((f) => f.path)).toEqual(['package.json', 'Dockerfile', 'apps/web/package.json', 'backend/requirements.txt']);
    expect(repo.rootNames).toContain('README.md');
    expect(repo.errors).toEqual([
      { kind: 'parse', message: 'manifest is truncated by GitHub (too large); skipped', repo: 'acme/shiny', file: 'frontend/package.json' },
    ]);
    expect(queries).toHaveLength(2); // one tree query, one blob query
    expect(queries[1]).toContain('... on Blob{isTruncated isBinary text}');
  });

  it('uses batches of 12 repos per query', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `o/r${i}`);
    const { fetchFn, queries } = graphqlServer();
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, names);
    expect(out.size).toBe(30);
    const treeSizes = queries.filter(isTreeQuery).map((q) => queryRepos(q).length);
    expect(treeSizes).toEqual([12, 12, 6]);
    expect(Math.max(...queries.map((q) => queryRepos(q).length))).toBeLessThanOrEqual(12);
  });

  it('keeps blob queries to the blob cap', async () => {
    const names = Array.from({ length: 6 }, (_, i) => `o/r${i}`);
    const { fetchFn, queries } = graphqlServer();
    const { client } = makeClient(fetchFn);
    await fetchManifests(client, names, { maxBlobsPerQuery: 10 }); // each repo has 5 files -> 2 repos per query
    const blobQueries = queries.filter((q) => !isTreeQuery(q));
    expect(blobQueries.map((q) => queryRepos(q).length)).toEqual([2, 2, 2]);
  });

  it('caps the files read per repo, root first', async () => {
    const { fetchFn } = graphqlServer();
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['a/b'], { maxFilesPerRepo: 2 });
    expect(out.get('a/b')!.files.map((f) => f.path)).toEqual(['package.json', 'Dockerfile']);
  });

  it('splits a batch in half after a 502 and still returns every repo', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `o/r${i}`);
    // Fails any query with more than 3 repos.
    const { fetchFn, queries } = graphqlServer({}, (q) => (queryRepos(q).length > 3 ? empty(502) : null));
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, names);
    expect([...out.values()].every((r) => r.errors.every((e) => e.kind === 'parse'))).toBe(true);
    expect([...out.values()].every((r) => r.files.length === 4)).toBe(true);
    const sizes = queries.filter(isTreeQuery).map((q) => queryRepos(q).length);
    expect(sizes[0]).toBe(12); // first try
    expect(sizes[1]).toBe(6); // then halves
    expect(sizes).toContain(3);
  });

  it('gives one repo a fetch error when it still fails alone, and the other repos are unaffected', async () => {
    const { fetchFn } = graphqlServer({}, (q) => (q.includes('name:"bad"') ? empty(502) : null));
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['o/good1', 'o/bad', 'o/good2']);
    expect(out.get('o/bad')!.errors).toEqual([
      { kind: 'fetch', message: 'HTTP 502 (after one retry)', repo: 'o/bad' },
    ]);
    expect(out.get('o/good1')!.files).toHaveLength(4);
    expect(out.get('o/good2')!.files).toHaveLength(4);
  });

  it('retries a lone repo once: a single 502 then success is not an error', async () => {
    let failed = false;
    const { fetchFn } = graphqlServer({}, () => {
      if (failed) return null;
      failed = true;
      return empty(502);
    });
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['o/one']);
    expect(out.get('o/one')!.errors.map((e) => e.kind)).toEqual(['parse']); // only the truncated file
    expect(out.get('o/one')!.files).toHaveLength(4);
  });

  it('gives a fetch error to a repo GraphQL could not find, with GitHub\'s message', async () => {
    const { fetchFn } = graphqlServer({ 'o/gone': null });
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['o/gone', 'o/here']);
    expect(out.get('o/gone')!.errors[0]).toMatchObject({ kind: 'fetch', repo: 'o/gone' });
    expect(out.get('o/gone')!.errors[0].message).toContain('Could not resolve to a Repository');
    expect(out.get('o/here')!.files).toHaveLength(4);
  });

  it('fails every repo in a batch on a non-transient error, with the message', async () => {
    const { client } = makeClient(async () => json({ errors: [{ message: 'Parse error on "}"' }] }));
    const out = await fetchManifests(client, ['o/a', 'o/b']);
    expect(out.get('o/a')!.errors).toEqual([{ kind: 'fetch', message: 'Parse error on "}"', repo: 'o/a' }]);
    expect(out.get('o/b')!.errors).toHaveLength(1);
  });

  it('gives binary blobs, text-less blobs and blobs missing from the response a skip and an error', async () => {
    const odd: Record<string, FakeBlob | null> = {
      'package.json': { isTruncated: false, isBinary: true, text: null },
      Dockerfile: { isTruncated: false, isBinary: false, text: null },
      'apps/web/package.json': null,
      'frontend/package.json': { isTruncated: false, isBinary: false, text: '{}' },
    };
    const { fetchFn } = graphqlServer({ 'o/odd': { tree, blobs: odd } });
    const { client } = makeClient(fetchFn);
    const repo = (await fetchManifests(client, ['o/odd'])).get('o/odd')!;
    expect(repo.files.map((f) => f.path)).toEqual(['frontend/package.json']);
    const byFile = Object.fromEntries(repo.errors.map((e) => [e.file, e]));
    expect(byFile['package.json']).toMatchObject({ kind: 'parse' });
    expect(byFile['Dockerfile']).toMatchObject({ kind: 'parse' });
    expect(byFile['apps/web/package.json']).toMatchObject({ kind: 'fetch' });
    expect(byFile['backend/requirements.txt']).toMatchObject({ kind: 'fetch' });
  });

  it('returns no files and no error for an empty repo (null root tree)', async () => {
    const { fetchFn, queries } = graphqlServer({ 'o/empty': { tree: { root: null, apps: null, packages: null, frontend: null, backend: null }, blobs: {} } });
    const { client } = makeClient(fetchFn);
    const repo = (await fetchManifests(client, ['o/empty'])).get('o/empty')!;
    expect(repo).toMatchObject({ files: [], errors: [], rootNames: [] });
    expect(queries).toHaveLength(1); // no blob query needed
  });

  it('rejects a name that is not owner/name without calling the API', async () => {
    let calls = 0;
    const { client } = makeClient(async () => {
      calls++;
      return json({});
    });
    const out = await fetchManifests(client, ['no-slash', 'a/b"; evil']);
    expect(out.get('no-slash')!.errors[0]).toMatchObject({ kind: 'fetch', repo: 'no-slash' });
    expect(out.get('a/b"; evil')!.errors).toHaveLength(1);
    expect(calls).toBe(0);
  });

  it('fails the blob step for a batch that keeps failing, per repo', async () => {
    const { fetchFn } = graphqlServer({}, (q) => (!isTreeQuery(q) ? empty(504) : null));
    const { client } = makeClient(fetchFn);
    const out = await fetchManifests(client, ['o/a', 'o/b']);
    expect(out.get('o/a')!.errors.some((e) => e.kind === 'fetch' && e.message.includes('HTTP 504'))).toBe(true);
    expect(out.get('o/b')!.errors.some((e) => e.kind === 'fetch')).toBe(true);
  });
});

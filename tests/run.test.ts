// End-to-end pipeline run against a fake GitHub: dataset written when ok, the old
// dataset.json left alone when not ok, a stopped run, contributor filtering, and CLI args.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Dataset } from '@hwsw/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFamilies } from '../scripts/corpus-index';
import { parseArgs, runPipeline, writeOutputs } from '../packages/pipeline/src/run';
import { isOk, summarize } from '../packages/pipeline/src/report';
import {
  empty, fixture, graphqlResponse, json, makeClient, searchResponse, type FakeBlob, type FakeRepo,
} from './helpers/fakeGithub';

const tree = fixture<Record<string, unknown>>('tree-react-app.json');
const blobs = fixture<Record<string, FakeBlob>>('blobs-react-app.json');
const families = loadFamilies();

const repo = (name: string, stars = 100): FakeRepo => ({
  full_name: name, stargazers_count: stars, created_at: '2026-10-20T10:00:00Z', language: 'TypeScript',
});

interface World {
  repos: FakeRepo[];
  /** contributors response per repo; default: two contributors */
  contributors?: Record<string, () => Response>;
  /** make graphql fail for repos whose name matches */
  graphqlFailFor?: (query: string) => boolean;
}

function fakeGithub(w: World) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/search/repositories')) return searchResponse(w.repos, url);
    const c = /\/repos\/([^/]+\/[^/]+)\/contributors/.exec(url);
    if (c) return w.contributors?.[c[1]]?.() ?? json(fixture('contributors-two.json'));
    if (url.endsWith('/graphql')) {
      const body = String(init?.body);
      if (w.graphqlFailFor?.(body)) return empty(502);
      return graphqlResponse(body, tree, blobs);
    }
    return empty(404);
  };
}

describe('runPipeline', () => {
  it('lists, filters by contributors, fetches manifests and builds records', async () => {
    const world: World = {
      repos: [repo('o/big', 300), repo('o/solo', 200), repo('o/empty', 150), repo('o/duo', 100)],
      contributors: {
        'o/solo': () => json([{ login: 'a' }]),
        'o/empty': () => empty(204),
      },
    };
    const { client } = makeClient(fakeGithub(world));
    const result = await runPipeline({ client });
    expect(result.listed).toBe(4);
    expect(result.droppedFewContributors).toBe(2);
    expect(result.records.map((r) => r.fullName)).toEqual(['o/big', 'o/duo']);
    const big = result.records[0];
    expect(big.contributors).toBe(2);
    expect(big.tags.map((t) => t.tag).sort()).toEqual(
      ['docker:node', 'npm:react', 'npm:react-dom', 'npm:vitest', 'npm:zod', 'pypi:numpy', 'pypi:requests'],
    );
    expect(result.aborted).toBeNull();
    // 4 contributor calls + search calls + graphql calls (tree + blobs)
    expect(result.calls.rest).toBe(4);
    expect(result.calls.graphql).toBe(2);
    expect(result.date).toBe('2026-11-01');
    // The truncated frontend/package.json is one parse error per kept repo: 2 of 4 listed repos = 50%.
    expect(result.errors.filter((e) => e.kind === 'parse')).toHaveLength(2);
    expect(isOk(result)).toBe(false);
  });

  it('lists repos with no tags in `tagless` with their root names', async () => {
    const emptyTree = { root: { entries: [{ name: 'main.c', type: 'blob' }] }, apps: null, packages: null, frontend: null, backend: null };
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/graphql')) return graphqlResponse(String(init?.body), emptyTree, {});
      return fakeGithub({ repos: [repo('o/c')] })(url, init);
    };
    const { client } = makeClient(fetchFn);
    const result = await runPipeline({ client });
    expect(result.tagless).toEqual([{ fullName: 'o/c', rootNames: ['main.c'] }]);
    expect(isOk(result)).toBe(true);
    expect(summarize(result)).toMatchObject({ repos: 1, kept: 1, withTags: 0, ok: true });
  });

  it('a contributor lookup that fails is an error for that repo and the run goes on', async () => {
    const world: World = { repos: [repo('o/a'), repo('o/b')], contributors: { 'o/a': () => json({}, 500) } };
    const { client } = makeClient(fakeGithub(world));
    const result = await runPipeline({ client });
    expect(result.errors.find((e) => e.repo === 'o/a')).toMatchObject({ kind: 'fetch' });
    expect(result.records.map((r) => r.fullName)).toEqual(['o/b']);
    expect(result.droppedFewContributors).toBe(0);
  });

  it('stops with a rate_limit error when the wait is over 15 minutes, keeping what it has', async () => {
    const reset = String(Math.floor(Date.parse('2026-11-01T12:00:00Z') / 1000) + 3600);
    const world: World = {
      repos: [repo('o/a'), repo('o/b')],
      contributors: { 'o/b': () => empty(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }) },
    };
    const { client } = makeClient(fakeGithub(world));
    const result = await runPipeline({ client, concurrency: 1 });
    expect(result.aborted?.kind).toBe('rate_limit');
    expect(result.errors).toContain(result.aborted);
    expect(summarize(result).ok).toBe(false);
    expect(summarize(result).errors.rate_limit).toBe(1);
  });

  it('uses `limit` to sample instead of walking the whole league', async () => {
    const repos = Array.from({ length: 30 }, (_, i) => repo(`o/r${i}`));
    const { client } = makeClient(fakeGithub({ repos }));
    const result = await runPipeline({ client, limit: 5, concurrency: 3 });
    expect(result.listed).toBe(5);
  });

  it('logs progress through the log callback', async () => {
    const messages: string[] = [];
    const { client } = makeClient(fakeGithub({ repos: [repo('o/a')] }));
    await runPipeline({ client, log: (m) => messages.push(m) });
    expect(messages[0]).toMatch(/^listed 1 repos/);
    expect(messages.some((m) => m.startsWith('kept '))).toBe(true);
  });
});

describe('writeOutputs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hwsw-run-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  const okResult = async () => {
    const emptyTree = { root: { entries: [{ name: 'package.json', type: 'blob' }] }, apps: null, packages: null, frontend: null, backend: null };
    const okBlobs = { 'package.json': { isTruncated: false, isBinary: false, text: '{"dependencies":{"react":"^18.0.0"}}' } };
    const fetchFn = async (url: string, init?: RequestInit) =>
      url.endsWith('/graphql') ? graphqlResponse(String(init?.body), emptyTree, okBlobs) : fakeGithub({ repos: [repo('o/a'), repo('o/b')] })(url, init);
    return runPipeline({ client: makeClient(fetchFn).client });
  };
  // 2 repos, 1 of which has an error -> 50% -> not ok
  const failedResult = async () => {
    const world: World = { repos: [repo('o/a'), repo('o/b')], contributors: { 'o/a': () => json({}, 500) } };
    return runPipeline({ client: makeClient(fakeGithub(world)).client });
  };

  it('writes dataset.json (and report.md) for an ok run', async () => {
    const result = await okResult();
    const out = writeOutputs(result, families, dir);
    expect(out).toEqual({ ok: true, file: path.join(dir, 'dataset.json') });
    const ds = JSON.parse(readFileSync(out.file, 'utf8')) as Dataset;
    expect(ds.schemaVersion).toBe(1);
    expect(ds.run).toMatchObject({ repos: 2, kept: 2, withTags: 2, ok: true, errors: {} });
    expect(ds.repos.map((r) => r.fullName)).toEqual(['o/a', 'o/b']);
    expect(ds.families.length).toBe(families.length);
    expect(readFileSync(path.join(dir, 'report.md'), 'utf8')).toContain(': OK');
    expect(existsSync(path.join(dir, 'dataset.json.tmp'))).toBe(false);
  });

  it('does NOT overwrite an existing dataset.json when the run is not ok, and writes run-failed.json', async () => {
    const old = '{"old":"dataset"}';
    writeFileSync(path.join(dir, 'dataset.json'), old);
    const result = await failedResult();
    expect(isOk(result)).toBe(false);
    const out = writeOutputs(result, families, dir, 'https://example.test/run/1');
    expect(out).toEqual({ ok: false, file: path.join(dir, 'run-failed.json') });
    expect(readFileSync(path.join(dir, 'dataset.json'), 'utf8')).toBe(old);
    const failed = JSON.parse(readFileSync(out.file, 'utf8')) as { run: { ok: boolean }; errors: unknown[] };
    expect(failed.run.ok).toBe(false);
    expect(failed.errors).toHaveLength(2); // o/a contributors + o/b truncated manifest
    expect(readFileSync(path.join(dir, 'issue-body.md'), 'utf8')).toContain('Run: https://example.test/run/1');
  });

  it('does not create dataset.json when a failed run has none to keep', async () => {
    writeOutputs(await failedResult(), families, dir);
    expect(existsSync(path.join(dir, 'dataset.json'))).toBe(false);
  });

  it('removes a stale run-failed.json after a good run', async () => {
    writeFileSync(path.join(dir, 'run-failed.json'), '{}');
    writeOutputs(await okResult(), families, dir);
    expect(existsSync(path.join(dir, 'run-failed.json'))).toBe(false);
  });

  it('appends the report to $GITHUB_STEP_SUMMARY when it is set', async () => {
    const summary = path.join(dir, 'step.md');
    writeFileSync(summary, 'earlier\n');
    process.env.GITHUB_STEP_SUMMARY = summary;
    writeOutputs(await okResult(), families, path.join(dir, 'out'));
    const text = readFileSync(summary, 'utf8');
    expect(text.startsWith('earlier\n')).toBe(true);
    expect(text).toContain('# Pipeline run');
  });
});

describe('parseArgs', () => {
  it('reads --limit and --out, with data as the default folder', () => {
    expect(parseArgs([])).toEqual({ limit: undefined, out: 'data' });
    expect(parseArgs(['--limit', '500', '--out', 'data/'])).toEqual({ limit: 500, out: 'data/' });
  });
  it('rejects bad input', () => {
    expect(parseArgs(['--limit', 'x'])).toEqual({ error: '--limit needs a positive whole number' });
    expect(parseArgs(['--limit', '0'])).toEqual({ error: '--limit needs a positive whole number' });
    expect(parseArgs(['--out'])).toEqual({ error: '--out needs a folder' });
    expect(parseArgs(['--what'])).toEqual({ error: 'unknown argument --what' });
  });
});

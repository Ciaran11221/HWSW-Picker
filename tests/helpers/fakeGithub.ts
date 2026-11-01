// Test doubles for the GitHub API: a fake clock (so nothing sleeps) and fake `fetch`
// functions that answer from small recorded JSON files in corpus/github/ or from
// in-memory lists. No test using these touches the network.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubClient, type ClientOptions, type FetchFn } from '../../packages/pipeline/src/github/client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reads a JSON file from corpus/github/. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, 'corpus', 'github', name), 'utf8')) as T;
}

export const NOW = Date.parse('2026-11-01T12:00:00Z');

/** A clock where sleeping just moves time forward and is recorded. */
export function makeClock(start: number = NOW) {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export const empty = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers });

/** A client wired to a fake fetch and the fake clock. */
export function makeClient(fetchFn: FetchFn, extra: Partial<ClientOptions> = {}) {
  const clock = makeClock();
  const client = new GitHubClient({ token: 'test-token', fetch: fetchFn, now: clock.now, sleep: clock.sleep, ...extra });
  return { client, clock };
}

// ---- search ---------------------------------------------------------------------------

export interface FakeRepo {
  full_name: string;
  stargazers_count: number;
  created_at: string;
  language: string | null;
}

/** Answers /search/repositories from a list, honouring created:a..b, stars:>=N / stars:a..b, per_page, page. */
export function searchResponse(repos: readonly FakeRepo[], url: string): Response {
  const u = new URL(url);
  const q = u.searchParams.get('q') ?? '';
  const created = /created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(q);
  const geq = /stars:>=(\d+)/.exec(q);
  const range = /stars:(\d+)\.\.(\d+)/.exec(q);
  const lo = geq ? Number(geq[1]) : range ? Number(range[1]) : 0;
  const hi = range ? Number(range[2]) : Infinity;
  const hits = repos
    .filter((r) => {
      const day = r.created_at.slice(0, 10);
      return (!created || (day >= created[1] && day <= created[2])) && r.stargazers_count >= lo && r.stargazers_count <= hi;
    })
    .sort((a, b) => b.stargazers_count - a.stargazers_count || (a.full_name < b.full_name ? -1 : 1));
  const perPage = Number(u.searchParams.get('per_page') ?? 30);
  const page = Number(u.searchParams.get('page') ?? 1);
  if ((page - 1) * perPage >= 1000) return json({ message: 'Only the first 1000 search results are available' }, 422);
  return json({ total_count: hits.length, incomplete_results: false, items: hits.slice((page - 1) * perPage, page * perPage) });
}

// ---- graphql --------------------------------------------------------------------------

/** The `owner/name` of each aliased repository in a GraphQL query, in order. */
export function queryRepos(query: string): { alias: string; fullName: string }[] {
  return [...query.matchAll(/(r\d+): repository\(owner:"([^"]+)", name:"([^"]+)"\)/g)].map((m) => ({
    alias: m[1],
    fullName: `${m[2]}/${m[3]}`,
  }));
}

export const isTreeQuery = (query: string): boolean => query.includes('entries{name type}');

/** The file paths asked for in a blob query, per alias. */
export function queryBlobPaths(query: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of query.split(/(?=r\d+: repository)/)) {
    const alias = /^(r\d+): repository/.exec(part)?.[1];
    if (!alias) continue;
    out.set(alias, [...part.matchAll(/f\d+: object\(expression:"HEAD:([^"]+)"\)/g)].map((m) => m[1]));
  }
  return out;
}

export interface FakeBlob {
  isTruncated: boolean;
  isBinary: boolean;
  text: string | null;
}

/**
 * Answers a GraphQL manifest query. `tree` and `blobs` give the data for every repo unless
 * `perRepo` has an entry for it (null there means "repository not found").
 */
export function graphqlResponse(
  body: string,
  tree: unknown,
  blobs: Record<string, FakeBlob | null>,
  perRepo: Record<string, { tree: unknown; blobs: Record<string, FakeBlob | null> } | null> = {},
): Response {
  const query = (JSON.parse(body) as { query: string }).query;
  const repos = queryRepos(query);
  const data: Record<string, unknown> = {};
  const errors: unknown[] = [];
  if (isTreeQuery(query)) {
    for (const { alias, fullName } of repos) {
      const own = fullName in perRepo ? perRepo[fullName] : { tree, blobs };
      if (own === null) {
        data[alias] = null;
        errors.push({ type: 'NOT_FOUND', path: [alias], message: `Could not resolve to a Repository with the name '${fullName}'.` });
      } else {
        data[alias] = own.tree;
      }
    }
  } else {
    const paths = queryBlobPaths(query);
    for (const { alias, fullName } of repos) {
      const own = fullName in perRepo ? perRepo[fullName] : { tree, blobs };
      const repoData: Record<string, unknown> = {};
      (paths.get(alias) ?? []).forEach((p, j) => {
        repoData[`f${j}`] = own?.blobs[p] ?? null;
      });
      data[alias] = repoData;
    }
  }
  return json(errors.length > 0 ? { data, errors } : { data });
}

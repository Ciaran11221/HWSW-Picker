// League listing: date slicing past the 1000-result search cap, star slicing for a
// single busy day, the sampled `limit` mode, and search failures.

import { describe, expect, it } from 'vitest';
import { listLeague } from '../packages/pipeline/src/github/league';
import { empty, fixture, json, makeClient, searchResponse, type FakeRepo } from './helpers/fakeGithub';

/** `n` repos on `day`, star counts from `firstStars` up (or all equal when `flat`). */
function dayRepos(day: string, n: number, firstStars: number, flat = false): FakeRepo[] {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `d${day}/r${i}`,
    stargazers_count: flat ? firstStars : firstStars + i,
    created_at: `${day}T08:00:00Z`,
    language: 'TypeScript',
  }));
}

function server(repos: FakeRepo[]) {
  const queries: string[] = [];
  const perQuery = new Map<string, number>();
  const fetchFn = async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    queries.push(q);
    const r = searchResponse(repos, url);
    perQuery.set(q, (perQuery.get(q) ?? 0) + 1);
    return r;
  };
  return { fetchFn, queries };
}

describe('listLeague', () => {
  it('reads the fixture response: name, stars, created, language', async () => {
    const { client } = makeClient(async () => json(fixture('search-two-repos.json')));
    const out = await listLeague(client, { months: 1 });
    expect(out.errors).toEqual([]);
    expect(out.repos).toEqual([
      { fullName: 'acme/shiny', stars: 120, createdAt: '2026-03-04T10:00:00Z', primaryLanguage: 'TypeScript' },
      { fullName: 'acme/quiet', stars: 55, createdAt: '2026-03-04T12:30:00Z', primaryLanguage: null },
    ]);
  });

  it('asks for the last 12 months with the 50 star bar', async () => {
    const { fetchFn, queries } = server([]);
    const { client } = makeClient(fetchFn);
    await listLeague(client);
    expect(queries).toEqual(['created:2025-11-01..2026-11-01 stars:>=50']);
  });

  it('splits the date range until each slice has 1000 or fewer results, losing and repeating nothing', async () => {
    // 2400 repos over 6 days, 400 per day: needs at least two levels of halving.
    const repos = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']
      .flatMap((d, k) => dayRepos(d, 400, 50 + k * 1000));
    const { fetchFn, queries } = server(repos);
    const { client } = makeClient(fetchFn);
    const out = await listLeague(client, { months: 1 });
    expect(out.errors).toEqual([]);
    expect(out.repos).toHaveLength(2400);
    expect(new Set(out.repos.map((r) => r.fullName)).size).toBe(2400);
    // The first query covered the whole month and was over the cap, so it was split.
    expect(queries[0]).toBe('created:2026-10-01..2026-11-01 stars:>=50');
    expect(queries.filter((q) => q.startsWith('created:2026-10-01..2026-11-01')).length).toBe(1);
    expect(queries.length).toBeGreaterThan(6);
  });

  it('reads more than one page of a slice', async () => {
    const { fetchFn, queries } = server(dayRepos('2026-10-10', 250, 50));
    const { client } = makeClient(fetchFn);
    const out = await listLeague(client, { months: 1 });
    expect(out.repos).toHaveLength(250);
    expect(queries).toHaveLength(3); // pages 1..3 of one query
  });

  it('slices a single day over 1000 by stars', async () => {
    // 1300 repos, one day, stars 50..1349.
    const repos = dayRepos('2026-10-10', 1300, 50);
    const { fetchFn, queries } = server(repos);
    const { client } = makeClient(fetchFn);
    const out = await listLeague(client, { months: 1 });
    expect(out.errors).toEqual([]);
    expect(out.repos).toHaveLength(1300);
    expect(new Set(out.repos.map((r) => r.fullName)).size).toBe(1300);
    expect(queries.some((q) => q.includes('stars:50..99'))).toBe(true);
    expect(queries.some((q) => /stars:>=\d+/.test(q) && !q.includes('>=50'))).toBe(true);
  });

  it('lists the first 1000 and records an error when one day and one star count hold over 1000 repos', async () => {
    const { fetchFn } = server(dayRepos('2026-10-10', 1100, 60, true));
    const { client } = makeClient(fetchFn);
    const out = await listLeague(client, { months: 1 });
    expect(out.repos).toHaveLength(1000);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ kind: 'fetch' });
    expect(out.errors[0].message).toMatch(/only the first 1000/);
  });

  it('stops at the limit and samples days spread over the period', async () => {
    const days = Array.from({ length: 60 }, (_, i) => `2026-09-${String((i % 30) + 1).padStart(2, '0')}`);
    // 3 repos on each of 30 September days.
    const repos = [...new Set(days)].flatMap((d) => dayRepos(d, 3, 50));
    const { fetchFn, queries } = server(repos);
    const { client } = makeClient(fetchFn);
    const out = await listLeague(client, { limit: 10, months: 2 });
    expect(out.repos).toHaveLength(10);
    // Far fewer queries than walking every day of the 2 months.
    expect(queries.length).toBeLessThan(40);
    const q0 = queries[0];
    expect(q0).toMatch(/^created:(\d{4}-\d{2}-\d{2})\.\.\1 /); // a single day
  });

  it('records a fetch error for a failing search and carries on', async () => {
    let n = 0;
    const repos = dayRepos('2026-10-03', 5, 50);
    const { client } = makeClient(async (url) => {
      n++;
      return n <= 2 ? empty(503) : searchResponse(repos, url); // first call fails twice (one retry)
    });
    const out = await listLeague(client, { limit: 3, months: 1 });
    expect(out.errors[0]).toMatchObject({ kind: 'fetch' });
    expect(out.errors[0].message).toMatch(/HTTP 503/);
    expect(out.repos.length).toBeGreaterThan(0);
  });

  it('records errors for network failures, a bad body and a missing total_count', async () => {
    const down = makeClient(async () => {
      throw new Error('boom');
    });
    expect((await listLeague(down.client, { months: 1 })).errors[0].message).toMatch(/request failed: boom/);
    const notJson = makeClient(async () => new Response('nope', { status: 200 }));
    expect((await listLeague(notJson.client, { months: 1 })).errors[0].message).toMatch(/not JSON/);
    const noTotal = makeClient(async () => json({ items: [] }));
    expect((await listLeague(noTotal.client, { months: 1 })).errors[0].message).toMatch(/no total_count/);
  });

  it('skips a malformed item with an error and keeps the good ones', async () => {
    const good = { full_name: 'a/b', stargazers_count: 60, created_at: '2026-10-01T00:00:00Z', language: 'Go' };
    const { client } = makeClient(async () => json({ total_count: 3, items: [good, { full_name: 'x/y' }, null] }));
    const out = await listLeague(client, { months: 1 });
    expect(out.repos.map((r) => r.fullName)).toEqual(['a/b']);
    expect(out.errors).toHaveLength(2);
  });

  it('records an error when a later page fails', async () => {
    const repos = dayRepos('2026-10-10', 150, 50);
    const { client } = makeClient(async (url) => (new URL(url).searchParams.get('page') === '2' ? empty(422) : searchResponse(repos, url)));
    const out = await listLeague(client, { months: 1 });
    expect(out.repos).toHaveLength(100);
    expect(out.errors[0].detail).toMatch(/page 2/);
  });
});

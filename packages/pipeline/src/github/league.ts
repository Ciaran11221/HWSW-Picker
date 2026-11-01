// Lists the league: repos created in the last 12 months with at least 50 stars.
//
// The search API returns at most 1000 results per query, and the league is tens of
// thousands of repos. So the date range is split in half until every slice has 1000 or
// fewer results (same idea as spike/a1_sample.py `split`). A single day with more than
// 1000 results is split again by star count (50..99, 100..199, ..., then open-ended).
//
// With `limit` set, the whole league is not walked. Instead single days spread across
// the year are read in full until `limit` repos are collected (stride of 29 days, so
// weekdays rotate), which keeps a 500-repo test run spread over the year.

import type { PipelineError } from '@hwsw/core';
import type { GitHubClient } from './client';

export interface LeagueRepo {
  /** `owner/name` */
  fullName: string;
  stars: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
  primaryLanguage: string | null;
}

export interface LeagueOptions {
  /** Stop after this many repos and sample days across the year instead of walking all of it. */
  limit?: number;
  /** League length in months. Default 12. */
  months?: number;
  /** Star bar. Default 50. */
  minStars?: number;
}

export interface LeagueResult {
  repos: LeagueRepo[];
  /** Problems that may have left repos out of the list. Not attached to any one repo. */
  errors: PipelineError[];
}

const PAGE = 100;
const MAX_RESULTS = 1000;
const DAY_MS = 86_400_000;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

interface Stars { lo: number; hi: number | null }

interface Ctx {
  client: GitHubClient;
  limit: number;
  repos: Map<string, LeagueRepo>;
  errors: PipelineError[];
}

type PageResult = { total: number; items: unknown[] } | PipelineError;

async function searchPage(client: GitHubClient, q: string, page: number): Promise<PageResult> {
  const path = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${PAGE}&page=${page}`;
  const r = await client.get(path, 'search');
  if (r.status !== 200) {
    const why = r.status === 0 ? `request failed: ${r.networkError}` : `HTTP ${r.status}`;
    return { kind: 'fetch', message: `search failed (${why})`, detail: `${q} page ${page}` };
  }
  try {
    const body = JSON.parse(r.text) as { total_count?: unknown; items?: unknown };
    if (typeof body.total_count !== 'number' || !Array.isArray(body.items)) {
      return { kind: 'fetch', message: 'search response had no total_count or items', detail: q };
    }
    return { total: body.total_count, items: body.items };
  } catch {
    return { kind: 'fetch', message: 'search response was not JSON', detail: q };
  }
}

function addItems(ctx: Ctx, items: unknown[], q: string): void {
  for (const raw of items) {
    const it = raw as Record<string, unknown> | null;
    if (
      !it || typeof it.full_name !== 'string' || typeof it.stargazers_count !== 'number'
      || typeof it.created_at !== 'string'
    ) {
      ctx.errors.push({ kind: 'fetch', message: 'search item missing full_name, stargazers_count or created_at', detail: q });
      continue;
    }
    if (ctx.repos.size >= ctx.limit) return;
    ctx.repos.set(it.full_name, {
      fullName: it.full_name,
      stars: it.stargazers_count,
      createdAt: it.created_at,
      primaryLanguage: typeof it.language === 'string' ? it.language : null,
    });
  }
}

function starClause(s: Stars): string {
  return s.hi === null ? `stars:>=${s.lo}` : `stars:${s.lo}..${s.hi}`;
}

/** Collects every repo created between `a` and `b` (inclusive, `YYYY-MM-DD`) with stars in range. */
async function collect(ctx: Ctx, a: string, b: string, stars: Stars): Promise<void> {
  if (ctx.repos.size >= ctx.limit) return;
  const q = `created:${a}..${b} ${starClause(stars)}`;
  const first = await searchPage(ctx.client, q, 1);
  if ('kind' in first) {
    ctx.errors.push(first);
    return;
  }

  if (first.total <= MAX_RESULTS) {
    await readPages(ctx, q, first, first.total);
    return;
  }

  if (a !== b) {
    const mid = iso(dayMs(a) + Math.floor((dayMs(b) - dayMs(a)) / DAY_MS / 2) * DAY_MS);
    await collect(ctx, a, mid, stars);
    await collect(ctx, iso(dayMs(mid) + DAY_MS), b, stars);
    return;
  }

  // One day, still over 1000: split by stars.
  if (stars.hi !== null && stars.lo >= stars.hi) {
    ctx.errors.push({ kind: 'fetch', message: `${first.total} repos share one day and one star count; only the first ${MAX_RESULTS} listed`, detail: q });
    await readPages(ctx, q, first, MAX_RESULTS);
    return;
  }
  const mid = stars.hi === null ? stars.lo * 2 - 1 : Math.floor((stars.lo + stars.hi) / 2);
  await collect(ctx, a, b, { lo: stars.lo, hi: mid });
  await collect(ctx, a, b, { lo: mid + 1, hi: stars.hi });
}

async function readPages(ctx: Ctx, q: string, first: { items: unknown[] }, total: number): Promise<void> {
  addItems(ctx, first.items, q);
  const pages = Math.ceil(Math.min(total, MAX_RESULTS) / PAGE);
  for (let p = 2; p <= pages && ctx.repos.size < ctx.limit; p++) {
    const next = await searchPage(ctx.client, q, p);
    if ('kind' in next) {
      ctx.errors.push(next);
      return;
    }
    addItems(ctx, next.items, q);
  }
}

/** Lists the league. Throws only RunAborted (from the client). */
export async function listLeague(client: GitHubClient, opts: LeagueOptions = {}): Promise<LeagueResult> {
  const months = opts.months ?? 12;
  const minStars = opts.minStars ?? 50;
  const ctx: Ctx = { client, limit: opts.limit ?? Number.POSITIVE_INFINITY, repos: new Map(), errors: [] };

  const todayMs = dayMs(iso(client.now()));
  const startDate = new Date(todayMs);
  startDate.setUTCMonth(startDate.getUTCMonth() - months);
  const start = iso(startDate.getTime());
  const end = iso(todayMs);
  const stars: Stars = { lo: minStars, hi: null };

  if (opts.limit === undefined) {
    await collect(ctx, start, end, stars);
  } else {
    const spanDays = Math.round((todayMs - startDate.getTime()) / DAY_MS) + 1;
    let stride = 29;
    while (gcd(stride, spanDays) !== 1) stride++;
    for (let i = 0; i < spanDays && ctx.repos.size < ctx.limit; i++) {
      const day = iso(startDate.getTime() + ((i * stride) % spanDays) * DAY_MS);
      await collect(ctx, day, day, stars);
    }
  }
  return { repos: [...ctx.repos.values()], errors: ctx.errors };
}

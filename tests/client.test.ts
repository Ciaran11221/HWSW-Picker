// GitHub client: auth header, call counting, rate-limit waits (and the 15 minute stop),
// search spacing, one retry on 5xx, and GraphQL result shapes. No network, no real sleeping.

import { describe, expect, it } from 'vitest';
import { RunAborted, isTransient, rateLimitWaitMs, type HttpResult } from '../packages/pipeline/src/github/client';
import { NOW, empty, json, makeClient } from './helpers/fakeGithub';

const res = (status: number, headers: Record<string, string> = {}, text = ''): HttpResult => ({
  status,
  headers: new Headers(headers),
  text,
});

describe('rateLimitWaitMs', () => {
  it('is null for non-limit statuses and plain 403s', () => {
    expect(rateLimitWaitMs(res(200), NOW)).toBeNull();
    expect(rateLimitWaitMs(res(404), NOW)).toBeNull();
    expect(rateLimitWaitMs(res(403, {}, 'Resource not accessible'), NOW)).toBeNull();
  });
  it('uses retry-after seconds', () => {
    expect(rateLimitWaitMs(res(429, { 'retry-after': '7' }), NOW)).toBe(7000);
  });
  it('waits until x-ratelimit-reset plus one second when remaining is 0', () => {
    const reset = String(Math.floor(NOW / 1000) + 90);
    expect(rateLimitWaitMs(res(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), NOW)).toBe(91_000);
  });
  it('never returns a negative wait when the reset time has passed', () => {
    const reset = String(Math.floor(NOW / 1000) - 50);
    expect(rateLimitWaitMs(res(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), NOW)).toBe(1000);
  });
  it('falls back to 60 s when remaining is 0 but no reset is sent, or the body says rate limit', () => {
    expect(rateLimitWaitMs(res(403, { 'x-ratelimit-remaining': '0' }), NOW)).toBe(60_000);
    expect(rateLimitWaitMs(res(403, {}, 'You have exceeded a secondary rate limit'), NOW)).toBe(60_000);
  });
  it('ignores a nonsense retry-after and keeps looking', () => {
    expect(rateLimitWaitMs(res(429, { 'retry-after': 'soon' }), NOW)).toBeNull();
  });
});

describe('isTransient', () => {
  it('is true for status 0 and 5xx only', () => {
    expect([0, 500, 502, 504].map((s) => isTransient(res(s)))).toEqual([true, true, true, true]);
    expect([200, 404, 403, 429].map((s) => isTransient(res(s)))).toEqual([false, false, false, false]);
  });
});

describe('GitHubClient.get', () => {
  it('sends the token and counts calls by kind', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const { client } = makeClient(async (url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return json({ ok: true });
    });
    await client.get('/repos/a/b');
    await client.get('/search/repositories?q=x', 'search');
    expect(seen[0]).toEqual({ url: 'https://api.github.com/repos/a/b', auth: 'Bearer test-token' });
    expect(client.calls).toEqual({ rest: 1, search: 1, graphql: 0 });
  });

  it('waits out a 429 with retry-after, then succeeds', async () => {
    let n = 0;
    const { client, clock } = makeClient(async () => (++n === 1 ? empty(429, { 'retry-after': '12' }) : json({ ok: 1 })));
    const r = await client.get('/x');
    expect(r.status).toBe(200);
    expect(clock.sleeps).toEqual([12_000]);
    expect(client.calls.rest).toBe(2);
  });

  it('waits until the reset time when remaining is 0', async () => {
    let n = 0;
    const reset = String(Math.floor(NOW / 1000) + 300);
    const { client, clock } = makeClient(async () =>
      ++n === 1 ? empty(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }) : json({}));
    await client.get('/x');
    expect(clock.sleeps).toEqual([301_000]);
  });

  it('stops the run when the wait is over 15 minutes, and refuses every call after that', async () => {
    let calls = 0;
    const reset = String(Math.floor(NOW / 1000) + 16 * 60);
    const { client, clock } = makeClient(async () => {
      calls++;
      return empty(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset });
    });
    const err = await client.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunAborted);
    expect((err as RunAborted).error.kind).toBe('rate_limit');
    expect(clock.sleeps).toEqual([]);
    expect(client.abortedWith?.kind).toBe('rate_limit');
    await expect(client.get('/y')).rejects.toBeInstanceOf(RunAborted);
    expect(calls).toBe(1);
  });

  it('allows a wait of exactly 15 minutes', async () => {
    let n = 0;
    const { client, clock } = makeClient(async () => (++n === 1 ? empty(429, { 'retry-after': '900' }) : json({})));
    await client.get('/x');
    expect(clock.sleeps).toEqual([900_000]);
  });

  it('stops the run after 10 waits in a row', async () => {
    const { client } = makeClient(async () => empty(429, { 'retry-after': '1' }));
    await expect(client.get('/x')).rejects.toBeInstanceOf(RunAborted);
    expect(client.abortedWith?.message).toMatch(/after 10 waits/);
  });

  it('stops the run on 401 (bad token)', async () => {
    const { client } = makeClient(async () => json({ message: 'Bad credentials' }, 401));
    const err = await client.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunAborted);
    expect((err as RunAborted).error.kind).toBe('fetch');
  });

  it('does not treat a plain 403 as a rate limit', async () => {
    const { client, clock } = makeClient(async () => json({ message: 'Forbidden' }, 403));
    const r = await client.get('/x');
    expect(r.status).toBe(403);
    expect(clock.sleeps).toEqual([]);
  });

  it('retries once on 502, then gives the second result', async () => {
    let n = 0;
    const { client } = makeClient(async () => (++n === 1 ? empty(502) : json({ ok: 1 })));
    expect((await client.get('/x')).status).toBe(200);
    expect(n).toBe(2);
  });

  it('returns status 0 with the message after a network failure on both tries', async () => {
    let n = 0;
    const { client } = makeClient(async () => {
      n++;
      throw new Error('socket hang up');
    });
    const r = await client.get('/x');
    expect(r.status).toBe(0);
    expect(r.networkError).toBe('socket hang up');
    expect(n).toBe(2);
  });

  it('spaces search calls by the search interval', async () => {
    const { client, clock } = makeClient(async () => json({}));
    await client.get('/search/a', 'search');
    await client.get('/search/b', 'search');
    await client.get('/search/c', 'search');
    expect(clock.sleeps).toEqual([2100, 2100]);
  });
});

describe('GitHubClient.graphql', () => {
  it('returns data and errors on success', async () => {
    const { client } = makeClient(async () => json({ data: { r0: null }, errors: [{ message: 'nope', path: ['r0'] }] }));
    const r = await client.graphql('query { x }');
    expect(r).toEqual({ ok: true, data: { r0: null }, errors: [{ message: 'nope', path: ['r0'] }] });
    expect(client.calls.graphql).toBe(1);
  });

  it('does not retry by itself: a 502 comes back as transient after one call', async () => {
    const { client } = makeClient(async () => empty(502));
    expect(await client.graphql('q')).toEqual({ ok: false, transient: true, message: 'HTTP 502' });
    expect(client.calls.graphql).toBe(1);
  });

  it('reports a network failure as transient', async () => {
    const { client } = makeClient(async () => {
      throw new Error('timed out');
    });
    const r = await client.graphql('q');
    expect(r).toMatchObject({ ok: false, transient: true });
    expect((r as { message: string }).message).toContain('timed out');
  });

  it('treats a non-JSON 200 as transient', async () => {
    const { client } = makeClient(async () => new Response('<html>', { status: 200 }));
    expect(await client.graphql('q')).toMatchObject({ ok: false, transient: true });
  });

  it('treats resource-limit and timeout errors without data as transient, other errors as not', async () => {
    const limit = makeClient(async () => json({ errors: [{ type: 'RESOURCE_LIMITS_EXCEEDED', message: 'too big' }] }));
    expect(await limit.client.graphql('q')).toMatchObject({ ok: false, transient: true, message: 'too big' });
    const timeout = makeClient(async () => json({ errors: [{ message: 'Something went wrong while executing your query' }] }));
    expect(await timeout.client.graphql('q')).toMatchObject({ ok: false, transient: true });
    const syntax = makeClient(async () => json({ errors: [{ message: 'Parse error on "}"' }] }));
    expect(await syntax.client.graphql('q')).toMatchObject({ ok: false, transient: false });
    const none = makeClient(async () => json({}));
    expect(await none.client.graphql('q')).toEqual({ ok: false, transient: false, message: 'no data in response' });
  });

  it('treats other HTTP statuses as not transient', async () => {
    const { client } = makeClient(async () => json({ message: 'Not found' }, 404));
    expect(await client.graphql('q')).toMatchObject({ ok: false, transient: false });
  });
});

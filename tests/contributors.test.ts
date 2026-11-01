// Contributor counting: 200 -> array length, 204 -> 0, everything else is a fetch error.

import { describe, expect, it } from 'vitest';
import { countContributors } from '../packages/pipeline/src/github/contributors';
import { empty, fixture, json, makeClient } from './helpers/fakeGithub';

describe('countContributors', () => {
  it('counts the array on 200 and asks for per_page=2', async () => {
    let url = '';
    const { client } = makeClient(async (u) => {
      url = u;
      return json(fixture('contributors-two.json'));
    });
    expect(await countContributors(client, 'acme/shiny')).toEqual({ count: 2 });
    expect(url).toBe('https://api.github.com/repos/acme/shiny/contributors?per_page=2');
  });

  it('counts 1 and 0 from short arrays', async () => {
    expect(await countContributors(makeClient(async () => json([{ login: 'a' }])).client, 'a/b')).toEqual({ count: 1 });
    expect(await countContributors(makeClient(async () => json([])).client, 'a/b')).toEqual({ count: 0 });
  });

  it('reads 204 as 0 contributors', async () => {
    expect(await countContributors(makeClient(async () => empty(204)).client, 'a/b')).toEqual({ count: 0 });
  });

  it('returns a fetch error for the repo on 403, 404 and 5xx', async () => {
    for (const status of [403, 404, 500]) {
      const out = await countContributors(makeClient(async () => json({ message: 'x' }, status)).client, 'a/b');
      expect(out).toMatchObject({ error: { kind: 'fetch', repo: 'a/b' } });
      expect((out as { error: { message: string } }).error.message).toContain(`HTTP ${status}`);
    }
  });

  it('returns a fetch error on a network failure', async () => {
    const { client } = makeClient(async () => {
      throw new Error('reset');
    });
    const out = await countContributors(client, 'a/b');
    expect((out as { error: { message: string } }).error.message).toContain('request failed: reset');
  });

  it('returns a fetch error when a 200 body is not an array or not JSON', async () => {
    expect(await countContributors(makeClient(async () => json({ a: 1 })).client, 'a/b')).toMatchObject({ error: { kind: 'fetch' } });
    expect(await countContributors(makeClient(async () => new Response('x', { status: 200 })).client, 'a/b')).toMatchObject({ error: { kind: 'fetch' } });
  });
});

// Counts contributors with one REST call: GET /repos/{owner}/{name}/contributors?per_page=2.
// 200 -> the length of the array (0, 1 or 2; the page size caps it at 2, which is all the
// "at least 2 contributors" bar needs). 204 -> 0 (empty repo). Anything else is a 'fetch'
// error for that repo. We never guess a count.

import type { PipelineError } from '@hwsw/core';
import type { GitHubClient } from './client';

export type ContributorsResult = { count: number } | { error: PipelineError };

export async function countContributors(client: GitHubClient, fullName: string): Promise<ContributorsResult> {
  const r = await client.get(`/repos/${fullName}/contributors?per_page=2`);
  if (r.status === 204) return { count: 0 };
  if (r.status === 200) {
    try {
      const body: unknown = JSON.parse(r.text);
      if (Array.isArray(body)) return { count: body.length };
    } catch {
      // fall through to the error below
    }
    return { error: { kind: 'fetch', message: 'contributors response was not a JSON array', repo: fullName } };
  }
  const why = r.status === 0 ? `request failed: ${r.networkError}` : `HTTP ${r.status}`;
  return { error: { kind: 'fetch', message: `contributors lookup failed (${why})`, repo: fullName, detail: r.text.slice(0, 120) } };
}

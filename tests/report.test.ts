// Report: the 5% threshold (exactly 5% is ok, just over is not), the other not-ok
// reasons, the `run` summary, top tags with family flags, and the markdown renderers.

import type { Family, PipelineError, RepoRecord } from '@hwsw/core';
import { describe, expect, it } from 'vitest';
import {
  errorRepoCount, failureReasons, isOk, renderIssueBody, renderJobSummary, summarize, topTags, type RunResult,
} from '../packages/pipeline/src/report';

const rec = (name: string, tags: string[]): RepoRecord => ({
  fullName: name, createdAt: '2026-01-01T00:00:00Z', stars: 60, contributors: 2, primaryLanguage: null,
  tags: tags.map((t) => ({ tag: t as never, version: null })),
});
const repoErr = (repo: string, kind: PipelineError['kind'] = 'fetch'): PipelineError => ({ kind, message: `bad ${repo}`, repo });

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    date: '2026-11-01', listed: 100, droppedFewContributors: 10, records: [rec('a/a', ['npm:react']), rec('b/b', [])],
    errors: [], aborted: null, calls: { rest: 100, search: 5, graphql: 20 }, wallMs: 90_000, tagless: [], ...over,
  };
}
const errorsOn = (n: number): PipelineError[] => Array.from({ length: n }, (_, i) => repoErr(`o/r${i}`));

describe('the 5% rule', () => {
  it('is ok with no errors', () => {
    expect(isOk(run())).toBe(true);
    expect(failureReasons(run())).toEqual([]);
  });
  it('is ok at exactly 5% (5 of 100 repos)', () => {
    expect(isOk(run({ errors: errorsOn(5) }))).toBe(true);
  });
  it('is not ok just over 5% (6 of 100)', () => {
    const r = run({ errors: errorsOn(6) });
    expect(isOk(r)).toBe(false);
    expect(failureReasons(r)[0]).toMatch(/6 of 100 repos have an error.*more than 5%/);
  });
  it('works for other sizes: 1 of 20 is exactly 5%, 2 of 20 is over', () => {
    expect(isOk(run({ listed: 20, errors: errorsOn(1) }))).toBe(true);
    expect(isOk(run({ listed: 20, errors: errorsOn(2) }))).toBe(false);
    expect(isOk(run({ listed: 3, errors: errorsOn(1) }))).toBe(false);
  });
  it('counts a repo once however many errors it has', () => {
    const many = Array.from({ length: 30 }, () => repoErr('o/same', 'parse'));
    expect(errorRepoCount(many)).toBe(1);
    expect(isOk(run({ errors: many }))).toBe(true);
  });
  it('is not ok when the run was stopped, and says why once', () => {
    const aborted: PipelineError = { kind: 'rate_limit', message: 'wait too long' };
    const r = run({ aborted, errors: [aborted] });
    expect(isOk(r)).toBe(false);
    expect(failureReasons(r)).toEqual(['run stopped early: wait too long']);
  });
  it('is not ok when nothing was listed', () => {
    expect(failureReasons(run({ listed: 0, records: [] }))).toEqual(['no repos were listed']);
  });
  it('is not ok when an error belongs to no repo (the list may be short)', () => {
    const r = run({ errors: [{ kind: 'fetch', message: 'slice failed' }] });
    expect(failureReasons(r)[0]).toMatch(/1 error\(s\) not tied to a repo/);
  });
});

describe('summarize', () => {
  it('builds the run object for the site banner', () => {
    const r = run({ errors: [repoErr('o/a'), repoErr('o/b', 'parse'), repoErr('o/c', 'parse')] });
    expect(summarize(r)).toEqual({
      date: '2026-11-01', repos: 100, kept: 2, withTags: 1, errors: { fetch: 1, parse: 2 }, ok: true,
    });
  });
  it('has ok false and empty error counts when nothing went wrong but nothing was listed', () => {
    expect(summarize(run({ listed: 0, records: [] }))).toMatchObject({ repos: 0, kept: 0, withTags: 0, errors: {}, ok: false });
  });
});

describe('topTags', () => {
  const react: Family = { id: 'react', name: 'React', kind: 'library', members: ['npm:react'], eol: 'react' };
  const records = [
    rec('a/1', ['npm:react', 'npm:left-pad']), rec('a/2', ['npm:react', 'npm:zzz']), rec('a/3', ['npm:left-pad']),
  ];
  it('orders by repo count, then name, and flags tags with no family', () => {
    expect(topTags(records, [react])).toEqual([
      { tag: 'npm:left-pad', repos: 2, family: null },
      { tag: 'npm:react', repos: 2, family: 'react' },
      { tag: 'npm:zzz', repos: 1, family: null },
    ]);
  });
  it('cuts the list at n', () => {
    expect(topTags(records, [react], 1)).toHaveLength(1);
  });
});

describe('markdown', () => {
  const families: Family[] = [{ id: 'react', name: 'React', kind: 'library', members: ['npm:react'], eol: 'react' }];

  it('job summary says OK, shows the numbers and the family column', () => {
    const md = renderJobSummary(run(), families);
    expect(md).toContain('# Pipeline run 2026-11-01: OK');
    expect(md).toContain('| Repos listed | 100 |');
    expect(md).toContain('| Kept with at least 1 tag | 1 (50.0%) |');
    expect(md).toContain('| 1 | npm:react | 1 | react |');
    expect(md).toContain('None.');
  });

  it('job summary says FAILED with the reasons and escapes pipes in messages', () => {
    const errors = [...errorsOn(6), { kind: 'parse' as const, message: 'a | b', repo: 'o/x', file: 'f.json' }];
    const md = renderJobSummary(run({ errors }), families);
    expect(md).toContain('# Pipeline run 2026-11-01: FAILED');
    expect(md).toContain('more than 5%');
    expect(md).toContain('a \\| b');
  });

  it('marks tags without a family', () => {
    expect(renderJobSummary(run({ records: [rec('a/a', ['npm:unknown'])] }), families)).toContain('| 1 | npm:unknown | 1 | **none** |');
  });

  it('issue body lists reasons, the run link and Done when / If it reads otherwise', () => {
    const body = renderIssueBody(run({ errors: errorsOn(6) }), 'https://github.com/o/r/actions/runs/1');
    expect(body).toContain('did not pass its checks');
    expect(body).toContain('- 6 of 100 repos have an error');
    expect(body).toContain('Run: https://github.com/o/r/actions/runs/1');
    expect(body).toContain('## Done when');
    expect(body).toContain('## If it reads otherwise');
  });

  it('issue body copes with no reasons and no link', () => {
    const body = renderIssueBody(run());
    expect(body).toContain('(no reason recorded)');
    expect(body).not.toContain('Run:');
  });
});

// Turns one pipeline run into the three things people read (decision 2A):
//   1. `renderJobSummary`  markdown for the GitHub Actions job summary ($GITHUB_STEP_SUMMARY)
//   2. `renderIssueBody`   markdown for the issue opened when a scheduled run fails
//   3. `summarize`         the small `run` object stored inside dataset.json for the site banner
//
// The rule that decides `ok`: a run is NOT ok when
//   - it was stopped (rate limit wait too long, bad token), or
//   - no repos were listed, or
//   - an error that belongs to no repo happened (a search slice failed, so the list may be short), or
//   - more than 5% of the listed repos have at least one error. Exactly 5% is still ok.
// The 5% test uses whole numbers (errorRepos * 100 > listed * 5), so there is no rounding.

import type { Family, PipelineError, PipelineErrorKind, RepoRecord, RunSummary, TagId } from '@hwsw/core';
import { buildFamilyIndex } from './assemble';
import type { CallCounts } from './github/client';

/** Everything a finished (or stopped) run knows. */
export interface RunResult {
  /** `YYYY-MM-DD` */
  date: string;
  /** Repos the league search returned. */
  listed: number;
  /** Repos with fewer than 2 contributors. Dropped, not errors. */
  droppedFewContributors: number;
  /** Kept repos, sorted by full name. */
  records: RepoRecord[];
  /** Every error of the run, with `repo` set when it belongs to one repo. */
  errors: PipelineError[];
  /** Set when the run stopped early. */
  aborted: PipelineError | null;
  calls: CallCounts;
  wallMs: number;
  /** Kept repos with no tags, with the file and folder names in their root, to explain misses. */
  tagless: { fullName: string; rootNames: string[] }[];
}

/** Errors allowed as a share of listed repos before the run is not ok. */
export const MAX_ERROR_PERCENT = 5;
export const TOP_TAGS = 200;

/** Number of distinct repos with at least one error. */
export function errorRepoCount(errors: readonly PipelineError[]): number {
  return new Set(errors.flatMap((e) => (e.repo === undefined ? [] : [e.repo]))).size;
}

/** Why the run is not ok. Empty when it is ok. */
export function failureReasons(r: RunResult): string[] {
  const reasons: string[] = [];
  if (r.aborted) reasons.push(`run stopped early: ${r.aborted.message}`);
  if (r.listed === 0) reasons.push('no repos were listed');
  const unattached = r.errors.filter((e) => e.repo === undefined && e !== r.aborted);
  if (unattached.length > 0) reasons.push(`${unattached.length} error(s) not tied to a repo (the repo list may be short)`);
  const bad = errorRepoCount(r.errors);
  if (r.listed > 0 && bad * 100 > r.listed * MAX_ERROR_PERCENT) {
    reasons.push(`${bad} of ${r.listed} repos have an error (${pct(bad, r.listed)}), more than ${MAX_ERROR_PERCENT}%`);
  }
  return reasons;
}

export function isOk(r: RunResult): boolean {
  return failureReasons(r).length === 0;
}

function countByKind(errors: readonly PipelineError[]): Partial<Record<PipelineErrorKind, number>> {
  const out: Partial<Record<PipelineErrorKind, number>> = {};
  for (const e of errors) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/** The `run` object stored in dataset.json. */
export function summarize(r: RunResult): RunSummary {
  return {
    date: r.date,
    repos: r.listed,
    kept: r.records.length,
    withTags: r.records.filter((x) => x.tags.length > 0).length,
    errors: countByKind(r.errors),
    ok: isOk(r),
  };
}

function pct(n: number, of: number): string {
  return of === 0 ? 'n/a' : `${((n / of) * 100).toFixed(1)}%`;
}

export interface TagStat {
  tag: string;
  /** Repos that declare the tag. */
  repos: number;
  /** Family id, or null when the tag has no family. */
  family: string | null;
}

/** The `n` most used tags, each with its family (or null). Ties are broken by tag name. */
export function topTags(records: readonly RepoRecord[], families: readonly Family[], n: number = TOP_TAGS): TagStat[] {
  const index = buildFamilyIndex(families);
  const counts = new Map<string, number>();
  for (const rec of records) for (const t of rec.tags) counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([tag, repos]) => ({ tag, repos, family: index.get(tag as TagId)?.id ?? null }));
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function errorSamples(errors: readonly PipelineError[], max: number): string[] {
  return errors.slice(0, max).map((e) => {
    const where = [e.repo, e.file].filter(Boolean).join(' ');
    return `- \`${e.kind}\` ${where ? `${esc(where)}: ` : ''}${esc(e.message)}`;
  });
}

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

function statsTable(r: RunResult): string[] {
  const withTags = r.records.filter((x) => x.tags.length > 0).length;
  const kinds = Object.entries(countByKind(r.errors)).map(([k, n]) => `${k}: ${n}`).join(', ') || 'none';
  const bad = errorRepoCount(r.errors);
  return [
    '| What | Value |',
    '|---|---|',
    `| Date | ${r.date} |`,
    `| Repos listed | ${r.listed} |`,
    `| Dropped (under 2 contributors) | ${r.droppedFewContributors} |`,
    `| Kept | ${r.records.length} |`,
    `| Kept with at least 1 tag | ${withTags} (${pct(withTags, r.records.length)}) |`,
    `| Repos with an error | ${bad} (${pct(bad, r.listed)} of listed) |`,
    `| Errors by kind | ${kinds} |`,
    `| API calls | rest ${r.calls.rest}, search ${r.calls.search}, graphql ${r.calls.graphql} |`,
    `| Wall time | ${minutes(r.wallMs)} |`,
  ];
}

/** Markdown for the Actions job summary. */
export function renderJobSummary(r: RunResult, families: readonly Family[]): string {
  const reasons = failureReasons(r);
  const tags = topTags(r.records, families);
  const noFamily = tags.filter((t) => t.family === null).length;
  const lines: string[] = [
    `# Pipeline run ${r.date}: ${reasons.length === 0 ? 'OK' : 'FAILED'}`,
    '',
    ...reasons.map((x) => `- ${x}`),
    ...(reasons.length > 0 ? [''] : []),
    ...statsTable(r),
    '',
    '## Errors (first 20)',
    '',
    ...(r.errors.length === 0 ? ['None.'] : errorSamples(r.errors, 20)),
    '',
    `## Top ${TOP_TAGS} tags (${noFamily} of ${tags.length} have no family)`,
    '',
    '| # | Tag | Repos | Family |',
    '|---|---|---|---|',
    ...tags.map((t, i) => `| ${i + 1} | ${esc(t.tag)} | ${t.repos} | ${t.family ?? '**none**'} |`),
    '',
  ];
  return lines.join('\n');
}

/** Markdown for the issue opened when a scheduled run fails. `runUrl` links to the Actions run. */
export function renderIssueBody(r: RunResult, runUrl?: string): string {
  const reasons = failureReasons(r);
  return [
    `The scheduled pipeline run on ${r.date} did not pass its checks. The site keeps the last good dataset.`,
    '',
    '## Why',
    '',
    ...(reasons.length === 0 ? ['(no reason recorded)'] : reasons.map((x) => `- ${x}`)),
    '',
    ...statsTable(r),
    '',
    '## First errors',
    '',
    ...(r.errors.length === 0 ? ['None.'] : errorSamples(r.errors, 10)),
    '',
    ...(runUrl ? [`Run: ${runUrl}`, ''] : []),
    '## Done when',
    '',
    '- A new run reports ok (at most 5% of repos with an error, no stopped run).',
    '',
    '## If it reads otherwise',
    '',
    '- Read the error kinds in the job summary: `rate_limit` means the token budget is too small for the league size; `fetch` means GitHub or the network failed; `parse` means a manifest format changed.',
    '',
  ].join('\n');
}

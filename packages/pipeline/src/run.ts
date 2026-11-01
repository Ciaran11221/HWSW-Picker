// The pipeline run: list the league, count contributors, fetch and parse manifests,
// assemble records, write the dataset.
//
//   npm run pipeline -- --limit 500 --out data/
//
// Output rules (the site keeps the last good data):
//   - ok run     -> <out>/dataset.json is replaced (written to a temp file, then renamed)
//   - failed run -> <out>/run-failed.json is written, exit code 1, dataset.json is NOT touched
// Both also get <out>/report.md; a failed run also gets <out>/issue-body.md.
// When $GITHUB_STEP_SUMMARY is set, the report is appended to it.

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset, Family, PipelineError, RepoRecord } from '@hwsw/core';
import { assemble, MIN_CONTRIBUTORS } from './assemble';
import { GitHubClient, RunAborted } from './github/client';
import { countContributors } from './github/contributors';
import { listLeague } from './github/league';
import { fetchManifests } from './github/manifests';
import { isOk, renderIssueBody, renderJobSummary, summarize, type RunResult } from './report';

export interface RunOptions {
  client: GitHubClient;
  /** Stop after this many listed repos (a sample spread over the year). */
  limit?: number;
  /** Contributor lookups in flight at once. Default 8. */
  concurrency?: number;
  log?: (message: string) => void;
}

/** Runs `fn` over `items` with at most `n` in flight. Stops handing out items once `stop()` is true. */
async function pool<T>(items: T[], n: number, stop: () => boolean, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Runs the whole pipeline. Never throws: a stopped run comes back with `aborted` set. */
export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const { client } = opts;
  const log = opts.log ?? (() => {});
  const startedAt = client.now();
  const errors: PipelineError[] = [];
  const records: RepoRecord[] = [];
  const tagless: RunResult['tagless'] = [];
  let listed = 0;
  let dropped = 0;

  try {
    const league = await listLeague(client, { limit: opts.limit });
    listed = league.repos.length;
    errors.push(...league.errors);
    log(`listed ${listed} repos (${league.errors.length} listing errors)`);

    // Contributors first: it is one cheap call and drops repos before the heavier manifest queries.
    const counts = new Map<string, number>();
    let done = 0;
    await pool(league.repos, opts.concurrency ?? 8, () => client.abortedWith !== null, async (repo) => {
      const res = await countContributors(client, repo.fullName);
      if ('error' in res) errors.push(res.error);
      else counts.set(repo.fullName, res.count);
      if (++done % 100 === 0) log(`contributors: ${done}/${listed}`);
    });
    const kept = league.repos.filter((r) => (counts.get(r.fullName) ?? 0) >= MIN_CONTRIBUTORS);
    dropped = league.repos.filter((r) => (counts.get(r.fullName) ?? MIN_CONTRIBUTORS) < MIN_CONTRIBUTORS).length;
    log(`kept ${kept.length}, dropped ${dropped} with under ${MIN_CONTRIBUTORS} contributors`);

    const manifests = await fetchManifests(client, kept.map((r) => r.fullName));
    for (const repo of kept) {
      const m = manifests.get(repo.fullName)!;
      const { record, errors: repoErrors } = assemble(repo, counts.get(repo.fullName)!, m);
      errors.push(...repoErrors);
      records.push(record);
      if (record.tags.length === 0) tagless.push({ fullName: repo.fullName, rootNames: m.rootNames });
    }
  } catch (e) {
    if (!(e instanceof RunAborted)) throw e;
  }

  // A stop inside a worker or in the league step leaves the abort on the client.
  const aborted = client.abortedWith;
  if (aborted !== null) errors.push(aborted);
  records.sort((a, b) => (a.fullName < b.fullName ? -1 : 1));
  return {
    date: new Date(startedAt).toISOString().slice(0, 10),
    listed,
    droppedFewContributors: dropped,
    records,
    errors,
    aborted,
    calls: { ...client.calls },
    wallMs: client.now() - startedAt,
    tagless,
  };
}

export interface WriteOutcome {
  ok: boolean;
  /** The file written: dataset.json or run-failed.json. */
  file: string;
}

/**
 * Writes the outputs described at the top of this file. On a failed run an existing
 * dataset.json is left exactly as it was.
 */
export function writeOutputs(result: RunResult, families: Family[], outDir: string, runUrl?: string): WriteOutcome {
  mkdirSync(outDir, { recursive: true });
  const run = summarize(result);
  const reportPath = path.join(outDir, 'report.md');
  const report = renderJobSummary(result, families);
  writeFileSync(reportPath, report);
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) appendFileSync(stepSummary, `${report}\n`);

  if (isOk(result)) {
    const dataset: Dataset = { schemaVersion: 1, run, families, repos: result.records };
    const file = path.join(outDir, 'dataset.json');
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(dataset));
    renameSync(tmp, file);
    const stale = path.join(outDir, 'run-failed.json');
    if (existsSync(stale)) rmSync(stale);
    return { ok: true, file };
  }

  const file = path.join(outDir, 'run-failed.json');
  writeFileSync(file, `${JSON.stringify({ run, errors: result.errors.slice(0, 500), tagless: result.tagless.slice(0, 200), calls: result.calls, wallMs: result.wallMs }, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'issue-body.md'), renderIssueBody(result, runUrl));
  return { ok: false, file };
}

/** Reads `--limit N` and `--out DIR` from argv. Returns an error string for anything else. */
export function parseArgs(argv: readonly string[]): { limit?: number; out: string } | { error: string } {
  let limit: number | undefined;
  let out = 'data';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) return { error: '--limit needs a positive whole number' };
      limit = n;
    } else if (a === '--out') {
      const v = argv[++i];
      if (!v) return { error: '--out needs a folder' };
      out = v;
    } else {
      return { error: `unknown argument ${a}` };
    }
  }
  return { limit, out };
}

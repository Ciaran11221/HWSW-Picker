// Command line entry for the pipeline: `npm run pipeline -- --limit 500 --out data/`.
// Reads the token from GITHUB_TOKEN. Thin on purpose: all logic is in run.ts.

import { loadFamilies } from '../../../scripts/corpus-index';
import { GitHubClient } from './github/client';
import { summarize } from './report';
import { parseArgs, runPipeline, writeOutputs } from './run';

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(`${args.error}\nusage: npm run pipeline -- [--limit N] [--out DIR]`);
    return 2;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set');
    return 2;
  }
  const families = loadFamilies();
  const client = new GitHubClient({ token });
  const result = await runPipeline({ client, limit: args.limit, log: (m) => console.error(m) });
  const runUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const outcome = writeOutputs(result, families, args.out, runUrl);
  console.log(JSON.stringify({ ...summarize(result), calls: result.calls, wallMs: result.wallMs, dropped: result.droppedFewContributors, wrote: outcome.file }));
  return outcome.ok ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
}, (e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});

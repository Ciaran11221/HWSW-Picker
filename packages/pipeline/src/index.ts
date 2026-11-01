export const PIPELINE_VERSION = '0.0.0';

export { parseManifest, detectFormat, MANIFEST_FORMATS, lowestVersion, normalizePypiName } from './parsers/index';
export type { ManifestFormat } from './parsers/index';
export { assemble, buildFamilyIndex, MIN_CONTRIBUTORS } from './assemble';
export { GitHubClient, RunAborted } from './github/client';
export { listLeague } from './github/league';
export { countContributors } from './github/contributors';
export { fetchManifests } from './github/manifests';
export { runPipeline, writeOutputs } from './run';
export { summarize, renderJobSummary, renderIssueBody, topTags, isOk } from './report';
export type { RunResult } from './report';

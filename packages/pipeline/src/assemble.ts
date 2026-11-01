// Turns one repo's search result, contributor count and fetched manifests into a RepoRecord.
// Each manifest is parsed with parseManifest (which never throws); parser errors get the
// repo name attached and travel with the repo. Tags are deduped per repo, so a repo that
// lists npm:react in two package.json files has it once.
//
// Families are not stamped on the record: the dataset carries the family list and the
// site groups tags with it. `buildFamilyIndex` is the one place that does tag -> family.

import type { Family, PipelineError, RepoRecord, TagId } from '@hwsw/core';
import type { LeagueRepo } from './github/league';
import type { RepoManifests } from './github/manifests';
import { parseManifest } from './parsers/index';

/** A repo needs at least this many contributors to be kept. */
export const MIN_CONTRIBUTORS = 2;

/** Map from tag id to the one family that owns it. */
export function buildFamilyIndex(families: readonly Family[]): Map<TagId, Family> {
  const index = new Map<TagId, Family>();
  for (const f of families) for (const tag of f.members) index.set(tag, f);
  return index;
}

export interface Assembled {
  record: RepoRecord;
  /** Fetch errors and parse errors for this repo. */
  errors: PipelineError[];
}

export function assemble(repo: LeagueRepo, contributors: number, manifests: RepoManifests): Assembled {
  const errors: PipelineError[] = [...manifests.errors];
  const tags = new Map<TagId, string | null>();
  for (const file of manifests.files) {
    const parsed = parseManifest(file.path, file.content);
    for (const e of parsed.errors) errors.push({ ...e, repo: repo.fullName });
    for (const t of parsed.tags) {
      const seen = tags.get(t.tag);
      if (seen === undefined || (seen === null && t.version !== null)) tags.set(t.tag, t.version);
    }
  }
  return {
    record: {
      fullName: repo.fullName,
      createdAt: repo.createdAt,
      stars: repo.stars,
      contributors,
      primaryLanguage: repo.primaryLanguage,
      tags: [...tags.entries()].map(([tag, version]) => ({ tag, version })),
    },
    errors,
  };
}

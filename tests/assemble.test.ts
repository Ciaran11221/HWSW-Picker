// assemble(): manifests -> RepoRecord, tag dedupe, error pass-through, family index.

import { parseFamily } from '@hwsw/core';
import { describe, expect, it } from 'vitest';
import { assemble, buildFamilyIndex, MIN_CONTRIBUTORS } from '../packages/pipeline/src/assemble';
import type { LeagueRepo } from '../packages/pipeline/src/github/league';
import type { RepoManifests } from '../packages/pipeline/src/github/manifests';

const repo: LeagueRepo = { fullName: 'acme/shiny', stars: 120, createdAt: '2026-03-04T10:00:00Z', primaryLanguage: 'TypeScript' };
const manifests = (files: RepoManifests['files'], errors: RepoManifests['errors'] = []): RepoManifests => ({
  fullName: repo.fullName, files, errors, rootNames: [],
});

describe('assemble', () => {
  it('builds a record from the search result, contributors and parsed manifests', () => {
    const { record, errors } = assemble(repo, 2, manifests([
      { path: 'package.json', content: '{"dependencies":{"react":"^18.2.0"}}' },
      { path: 'backend/requirements.txt', content: 'requests==2.31.0\n' },
    ]));
    expect(errors).toEqual([]);
    expect(record).toEqual({
      fullName: 'acme/shiny',
      createdAt: '2026-03-04T10:00:00Z',
      stars: 120,
      contributors: 2,
      primaryLanguage: 'TypeScript',
      tags: [
        { tag: 'npm:react', version: '18.2.0' },
        { tag: 'pypi:requests', version: '2.31.0' },
      ],
    });
  });

  it('counts a tag once across files and prefers a version over none', () => {
    const { record } = assemble(repo, 3, manifests([
      { path: 'package.json', content: '{"dependencies":{"react":"*"}}' },
      { path: 'apps/web/package.json', content: '{"dependencies":{"react":"^17.0.0"}}' },
      { path: 'apps/api/package.json', content: '{"dependencies":{"react":"^16.0.0"}}' },
    ]));
    expect(record.tags).toEqual([{ tag: 'npm:react', version: '17.0.0' }]);
  });

  it('attaches the repo to parser errors and keeps fetch errors', () => {
    const fetchErr = { kind: 'fetch' as const, message: 'x', repo: 'acme/shiny' };
    const { record, errors } = assemble(repo, 2, manifests([{ path: 'package.json', content: '{not json' }], [fetchErr]));
    expect(record.tags).toEqual([]);
    expect(errors[0]).toBe(fetchErr);
    expect(errors[1]).toMatchObject({ kind: 'parse', repo: 'acme/shiny', file: 'package.json' });
  });

  it('gives a record with no tags when there are no files', () => {
    expect(assemble(repo, 2, manifests([])).record.tags).toEqual([]);
  });

  it('needs 2 contributors', () => {
    expect(MIN_CONTRIBUTORS).toBe(2);
  });
});

describe('buildFamilyIndex', () => {
  it('maps every member tag to its family', () => {
    const react = parseFamily({ id: 'react', name: 'React', kind: 'library', members: ['npm:react', 'npm:react-dom'], eol: 'react' });
    const index = buildFamilyIndex([react]);
    expect(index.get('npm:react-dom')).toBe(react);
    expect(index.get('npm:vue')).toBeUndefined();
  });
});

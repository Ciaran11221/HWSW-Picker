# HWSW-Picker

Pick a tech stack click by click. Each record is one real GitHub repo; its tags are what it uses. Clicking a tag keeps only the repos that use it (⊘ keeps those that don't) and recalculates what % of the remaining repos use every other tag. Out-of-date versions are flagged. Software mode only for now; Hardware is a later mode switch.

Read this file first, then open only the files the task needs.

## Repo map

A test (`tests/map.test.ts`) fails if a folder under `packages/` has no row here.

| Path | Holds |
|---|---|
| `packages/core` | Shared types: tag ids, families, repo records, out-of-date status. Used by both the pipeline and the site |
| `packages/pipeline` | Fetch repos (GitHub GraphQL), parse manifests, apply families and out-of-date flags, write the dataset. `src/parsers/` has one module per manifest format plus `parseManifest(fileName, content)` |
| `corpus/manifests` | Golden fixtures for the manifest parsers: `<format>/<case>.<original file name>` plus `<case>.expected.json`. Change expected files only with `npm run fixtures:update`, then read the diff |
| `corpus/families` | One JSON file per tag family (e.g. `react.json` groups `npm:react`, `npm:react-dom`, `npm:@types/react`) |
| `corpus/INDEX.md` | Generated list of all families. Never edit by hand: `npm run corpus:index` |
| `corpus/mistakes` | One JSON file per past mistake: what happened, rule, guard test. `INDEX.md` there is generated: `npm run corpus:index` |
| `corpus/eol-products.json` | Committed snapshot of endoflife.date products that have a package URL (`[{id, purls}]`). Regenerate: `npm run eol:snapshot -- <path to eol_full.json>` |
| `scripts` | Repo tooling (index generator) |
| `tests` | Repo-level tests: map coverage, corpus schema, index freshness |
| `spike` | Phase 0 throwaway Python measurements and `REPORT.md`. Not part of the product |
| `HANDOFF.md` | Current state, traps, next steps with falsifiers, not verified |
| `WORKLOG.md` | One row per merged PR: who wrote, who reviewed, test counts |

## Commands

| Command | Does |
|---|---|
| `npm ci` | Install exact dependencies |
| `npm test` | All tests (vitest) |
| `npm run test:coverage` | All tests plus the coverage gate: fails under 80% of lines in `packages/*/src` (what CI runs) |
| `npm run typecheck` | `tsc --noEmit` across packages |
| `npm run corpus:index` | Regenerate `corpus/INDEX.md` |
| `npm run fixtures:update` | Rewrite every `corpus/manifests/**/*.expected.json` from the current parsers. Review the diff before committing |

## Tag rules
- A tag id is `<ecosystem>:<package>`, all lowercase. Ecosystems: `npm`, `pypi`, `maven`, `go`, `cargo`, `docker`, `composer`, `gem`.
- A tag belongs to at most one family. Counting it twice would inflate the %.
- `eol` in a family is an endoflife.date product id, or `null` when endoflife.date has no product for it.

## Decisions (with dates)
| Date | Decision |
|---|---|
| 2026-10-30 | TypeScript for pipeline and site; Python only for throwaway spikes |
| 2026-10-30 | League = repos created in the last 12 months. Bar = >= 50 stars and >= 2 contributors |
| 2026-10-30 | Tags carry name and version; the panel shows the name, and clicking it splits by version |
| 2026-11-01 | Manifests read from the root plus one level (`apps/*`, `packages/*`, `frontend/`, `backend/`) |
| 2026-11-01 | Out-of-date = endoflife.date + npm `deprecated` / PyPI `yanked` + no release in 24 months |
| 2026-11-01 | Thoughtworks Radar dropped for v1: no reuse terms found |
| 2026-11-01 | `main` is protected: PR + green `test` check + up to date, admins included, no force-push |
| 2026-11-01 | Coverage gate: 80% lines in `packages/*/src`, enforced in CI |
| 2026-11-01 | Error reports: Actions job summary + auto-opened issue on scheduled failure + site banner |

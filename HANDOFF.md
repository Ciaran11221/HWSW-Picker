# Handoff

## Current state (2026-11-01)
- Phase 0 spike done: `spike/REPORT.md`.
- Phase 1 scaffold: TS workspaces (`packages/core`, `packages/pipeline`), 21 seed tag families, tests, and CI.
- No pipeline or site code yet.

## Traps
- **GraphQL batches:** 25 or more repos per query timed out (HTTP 502). Use 10-15.
- **SBOM endpoint:** returned 404 for 39/50 repos. Do not use it as the main fetch.
- **Missing manifests:** 47% of repos have none at the root. Read the root plus one level (`apps/*`, `packages/*`, `frontend/`, `backend/`).
- **endoflife.date ids:** they differ from package names (`nodejs`, `nextjs`, `tailwind-css`). Look the id up; never guess it.
- **Unknown tags:** a tag with no family shows as its raw package name. The coverage test for the top-200 tags lands with the pipeline.
- **TypeScript version:** 7.x installed as latest; not checked on 5.x.

## Next steps
| Step | Done when | If it reads otherwise |
|---|---|---|
| Phase 2 pipeline: GraphQL fetch for the league, root + one-level manifests, parsers per ecosystem, families, out-of-date flags, `dataset.json` | Run on 500 repos: >= 55% yield tags, and every top-200 tag has a family (test) | Under 55%: check which manifests are missed before scaling |
| Phase 3 site: filter engine + UI | One click recomputes every % in < 100 ms on the full dataset | Precompute counts in the pipeline |
| Phase 4 schedule + Pages | An Actions run rebuilds the data and Pages serves it | -- |

## Not verified
- Spike numbers come from small samples (see the report).
- Seed family members were checked against spike data only, not against the registries.

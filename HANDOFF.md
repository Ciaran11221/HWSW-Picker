# Handoff

## Current state (2026-11-01)
- Phase 0 spike done: `spike/REPORT.md`.
- Phase 1 scaffold: TS workspaces (`packages/core`, `packages/pipeline`), 21 seed tag families, tests, CI with an 80% line-coverage gate. `main` is protected.
- Phase 2a: manifest parsers for 11 formats, with golden fixtures.
- Phase 2b: fetcher, assembler, run report and `npm run pipeline`. A live `--limit 500` run (run twice, same result): 500 listed, 283 kept, 177 with tags (62.5%), 4 parse errors, 546 API calls, about 105 s.
- Not built yet: out-of-date flags, the site, the schedule.

## Traps
- **GraphQL batches:** 25 or more repos per query timed out (HTTP 502). Use 12; a failed batch splits in half.
- **SBOM endpoint:** returned 404 for 39/50 repos. Do not use it as the main fetch.
- **Missing manifests:** 47% of repos have none at the root. Read the root plus one level (`apps/*`, `packages/*`, `frontend/`, `backend/`).
- **endoflife.date ids:** they differ from package names (`nodejs`, `nextjs`, `tailwind-css`). Look the id up; never guess it.
- **Rate budget:** contributors cost 1 REST call per listed repo. The full league (about 70k listed for about 36k kept) is about 14 hours at 5000 calls/hour, and the Actions `GITHUB_TOKEN` allows fewer. A full run will stop on `rate_limit` until this is planned.
- **Caps:** contributor count is capped at 2 (`per_page=2`), so it means 0, 1 or 2+. At most 12 manifest files per repo are read, root first; nothing reports a cut.
- **Families:** 175 of the top 200 tags have no family. First missing: vite, lucide-react, prettier, @eslint/js, @vitejs/plugin-react, pydantic, ruff, clsx, postcss, typescript-eslint.
- **`--limit` sample:** whole single days spread across the year (stride 29). Not proven uniform.
- **TypeScript version:** 7.x installed as latest; not checked on 5.x.

## Next steps
| Step | Done when | If it reads otherwise |
|---|---|---|
| Rate-budget plan for the full league | One full run finishes without a `rate_limit` stop | Measure calls per kept repo and pick sampling or sharding |
| Families for the top 200 tags + coverage test | Every top-200 tag from a 500-repo run has a family | The missing tags are listed in `report.md` |
| Save root names of tag-less repos | The top 10 missed file names are known | -- |
| Out-of-date flags (endoflife.date, deprecated/yanked, 24-month stale) | Every flagged tag cites its source | -- |
| Phase 3 site: filter engine + UI | One click recomputes every % in < 100 ms on the full dataset | Precompute counts in the pipeline |
| Phase 4 schedule + Pages | An Actions run rebuilds the data and Pages serves it | -- |

## Not verified
- Spike numbers come from small samples (see the report).
- Seed family members were checked against spike data only, not against the registries.
- GitHub test fixtures are hand-made, not recorded from real responses. The real rate-limit path ran only with a fake clock.
- The 106 tag-less kept repos were not inspected.

# Spike report: data feasibility (issue #1)

Measured 2026-10-30. Scripts in this folder; raw data in `spike/data/` (git-ignored, not committed).
League = repos created >= 2025-10-30. Bar = >= 50 stars and >= 2 contributors.

| # | Measure | Result | Threshold | Verdict |
|---|---|---|---|---|
| a | Repos passing the bar | 68,717 x 105/200 = ~36,000 (re-run by reviewer: total_count 68,756) | < 5,000 fails | Meets |
| b | API calls per repo for dependencies | GraphQL batch 0.04-0.08 queries/repo, 1 point each; SBOM 1.0; REST contents 1.64 | > 3 for every method fails | Meets on calls. Hit rate only 44% (22/50) because of missing root manifests |
| c | endoflife.date coverage, top 100 tags | 9/100 by reviewer recount (agent reported 8) | < 30% fails | Misses |
| d | Licence / terms | GitHub: no clause on aggregates. endoflife.date: MIT repo. Thoughtworks Radar: no reuse terms found | Any source forbids reuse | Unclear for Thoughtworks; dropped for v1 |

## a. Repos passing the bar
- `gh api "search/repositories?q=created:>=2025-10-30+stars:>=50"` gave total_count = 68,717 (`a1_sample.py`).
- 200 sampled repos, contributors checked with `a2_contrib.py`: 105 had >= 2 contributors and 0 calls failed.
- 68,717 x 105 / 200 = 36,076. A 95% interval on the sample fraction gives about 31k to 41k.

## b. Dependency fetch, same 50-repo sample
| Method | Calls/repo | Repos with dependencies | Notes |
|---|---|---|---|
| GraphQL `object(expression: "HEAD:<file>")` batch | 0.04-0.08 | 22/50 (44%) | 50 or 25 repos per query timed out (HTTP 502) after ~11 s. Use 10-15 |
| SBOM `/dependency-graph/sbom` | 1.0 | 10/50 (20%) | 39/50 returned 404, including 17 repos with a manifest. Mostly transitive deps (1,503 packages vs 103 direct in one repo) |
| REST contents per file | 1.64 | baseline | -- |

- 94/200 (47%) have no recognised manifest at the root.
- Among repos with >= 2 contributors, 38% have none.
- Only the root was read, so monorepos count as having no manifest.

## c. endoflife.date coverage
- `https://endoflife.date/api/v1/products/full` worked. It includes package URLs (e.g. `pkg:npm/react`), so matching is easy.
- Matched: numpy, react, eslint, docker:node, openai (possible false match), tailwindcss, docker:python, express, next.
- Not covered, among others: typescript, pandas, pytest, vite, pydantic, requests.
- Top tags include near-duplicates (`react`, `react-dom`, `@types/react`), so they need grouping.
- npm `deprecated` and PyPI `yanked` can each be read in one registry call per package (one example each tested).

## Language spread (200 sample)
Python 26.5%, TypeScript 16%, Rust 8.5%, none 8.5%, HTML 8%, JavaScript 6%, Swift 4.5%, Go 4.5%, C++ 3.5%, Shell 3%.

## NOT verified
- Small samples: 200 (counts), 50 (fetch methods), about 100 repos' worth of tags (EOL).
- (a) is an extrapolation.
- Only root manifests were read; no subfolders, lockfiles or `*.csproj`.
- The cause of the SBOM 404s is unknown.
- EOL matching is by name or package URL only, with no version check.
- Registry flags were tested on one package each.
- Terms were read from page summaries, not the full legal text.
- GraphQL: the account counter moved by 7 for 16 queries; not explained.

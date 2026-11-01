# Work log

One row per merged PR.

| PR | What | Written by | Reviewed by | Tests |
|---|---|---|---|---|
| #2 | Phase 0 data spike + report | Sonnet | Opus (re-ran search total, contributor fraction, EOL match count) | None (measurement spike) |
| #4 | Scaffold: TS monorepo, tag-family corpus, CI | Haiku; eol ids and docs by Opus | Opus | 29/29 local (Windows); CI on PR |
| #7 | Mistakes corpus + guard-test check, eol snapshot | Haiku; purl fixes by Opus | Opus | 36/36 local (Windows); CI on PR |
| #8 | Manifest parsers (11 formats), structured errors, 42 golden fixtures | Sonnet; docker/dedupe fixes + 2 mistake entries by Opus | Opus | 264/264 local (Windows); CI on PR |
| #10 | 80% line-coverage gate in CI | Opus | Opus (threshold set to 99 -> exit 1, restored) | 264/264 local (Windows) and CI; 95.39% lines |
| #12 | GitHub fetcher, assembler, run report, pipeline script (Phase 2b) | Sonnet; coverage-gate fix and docs by Opus | Opus (re-ran live --limit 500: identical) | 356/356 local (Windows), 97.16% lines; live 283 kept, 62.5% with tags; CI on PR |

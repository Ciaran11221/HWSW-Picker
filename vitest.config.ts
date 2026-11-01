// Coverage gate (decided 1 Nov 2026): CI fails if packages/ code drops below 80% of lines run by tests.
// Only shipped code counts; CLI entry points (cli.ts, update-fixtures.ts) are excluded.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/pipeline/src/cli.ts', 'packages/pipeline/src/update-fixtures.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80 },
    },
  },
});

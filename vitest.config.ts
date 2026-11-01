import { defineConfig } from 'vitest/config';

// Coverage runs with `npm run test:coverage`. Entry points that only wire things together
// (cli.ts, update-fixtures.ts, the index re-exports) are left out of the gate.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/pipeline/src/cli.ts', 'packages/pipeline/src/update-fixtures.ts', 'packages/*/src/index.ts'],
      thresholds: { lines: 80 },
    },
  },
});

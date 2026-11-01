// Rewrites every corpus/manifests/**/*.expected.json from the current parsers.
// Run with: npm run fixtures:update
//
// Only run this on purpose. Then read `git diff corpus/manifests` line by line: a changed
// expected file means a parser's output changed, and that is exactly what the golden test guards.

import { writeFileSync } from 'node:fs';
import { listFixtures, readInput, renderExpected } from './fixtures';
import { parseManifest } from './parsers/index';

let changed = 0;
const fixtures = listFixtures();
for (const f of fixtures) {
  writeFileSync(f.expectedPath, renderExpected(parseManifest(f.fileName, readInput(f))), 'utf8');
  changed++;
}
console.log(`wrote ${changed} expected files for ${fixtures.length} fixtures. Review: git diff corpus/manifests`);

// package.json: dependencies, devDependencies, optionalDependencies -> npm tags.
// Not read: peerDependencies, bundledDependencies, `packageManager`, `engines`.

import type { ParseResult } from '@hwsw/core';
import { parseJsonObject, runParser } from './collector';
import { isRecord } from './versions';

const SECTIONS: [string, boolean][] = [
  ['dependencies', false],
  ['devDependencies', true],
  ['optionalDependencies', false],
];

/** Parses a package.json. `file` is only used to label errors. Never throws. */
export function parsePackageJson(content: string, file = 'package.json'): ParseResult {
  return runParser(file, content, (c, text) => {
    const doc = parseJsonObject(c, text);
    if (!doc) return;
    for (const [section, dev] of SECTIONS) {
      const deps = doc[section];
      if (deps === undefined) continue;
      if (!isRecord(deps)) {
        c.error(`"${section}" is not an object`);
        continue;
      }
      for (const [name, raw] of Object.entries(deps)) {
        if (typeof raw !== 'string') {
          c.error(`"${section}.${name}" is not a string`, JSON.stringify(raw));
          c.add('npm', name, null, dev, { version: null });
          continue;
        }
        // Alias form "npm:real-name@^1.2": the real package is what is used.
        const alias = /^npm:(@?[^@]+)(?:@(.*))?$/.exec(raw.trim());
        if (alias) c.add('npm', alias[1], alias[2] ?? null, dev);
        else c.add('npm', name, raw, dev);
      }
    }
  });
}

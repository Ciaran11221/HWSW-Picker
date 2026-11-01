// go.mod: `require` blocks and single-line requires -> go:<module path> tags.
// `// indirect` requirements still count. Version `v1.9.1` -> 1.9.1.
// Not read: the `go` and `toolchain` directives, replace, exclude, retract.

import type { ParseResult } from '@hwsw/core';
import { Collector, runParser } from './collector';

function addRequirement(c: Collector, body: string, original: string): void {
  const parts = body.trim().split(/\s+/);
  if (parts.length !== 2 || !/^v\d/.test(parts[1])) {
    c.error('require line is not "<module> <version>"', original);
    return;
  }
  c.add('go', parts[0], parts[1], false);
}

/** Parses a go.mod. `file` is only used to label errors. Never throws. */
export function parseGoMod(content: string, file = 'go.mod'): ParseResult {
  return runParser(file, content, (c, text) => {
    let inBlock = false;
    let blockDirective = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '').trim(); // "// indirect" is just a comment here
      if (line === '') continue;
      if (inBlock) {
        if (line === ')') inBlock = false;
        else if (blockDirective === 'require') addRequirement(c, line, raw);
        continue;
      }
      const block = /^(\w+)\s*\($/.exec(line);
      if (block) {
        inBlock = true;
        blockDirective = block[1];
        continue;
      }
      const single = /^require\s+(.+)$/.exec(line);
      if (single) addRequirement(c, single[1], raw);
    }
    if (inBlock) c.error(`unterminated ${blockDirective} block; file may be truncated`);
  });
}

// Dockerfile: each FROM line -> docker:<image> tag (tag after ":" is the version).
// Not tags: `FROM scratch`, and `FROM <earlier stage alias>` in multi-stage builds.
// An image built from an ARG (`FROM node:${V}`) is a 'parse' error, not a tag.
// Not read: COPY --from=<image>, RUN contents, ARG default values.

import type { ParseResult } from '@hwsw/core';
import { runParser } from './collector';
import { addImage } from './dockerImage';

/** Parses a Dockerfile. `file` is only used to label errors. Never throws. */
export function parseDockerfile(content: string, file = 'Dockerfile'): ParseResult {
  return runParser(file, content, (c, text) => {
    // Drop comment lines, then join lines ending in "\".
    const logical = text
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
      .replace(/\\[ \t]*\n/g, ' ')
      .split('\n');

    const stages = new Set<string>();
    for (const line of logical) {
      const m = /^\s*FROM(?:\s+(.*))?$/i.exec(line);
      if (!m) continue;
      const tokens = (m[1] ?? '').trim().split(/\s+/).filter((t) => !t.startsWith('--'));
      const image = tokens[0];
      if (!image) {
        c.error('FROM line has no image', line);
        continue;
      }
      const alias = tokens.length >= 3 && tokens[1].toLowerCase() === 'as' ? tokens[2].toLowerCase() : null;
      const lower = image.toLowerCase();
      if (lower !== 'scratch' && !stages.has(lower)) addImage(c, image, false, line);
      if (alias) stages.add(alias);
    }
  });
}

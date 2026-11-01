// requirements.txt -> pypi tags. Skips comments, option lines (-r, -e, -c, --index-url, ...),
// local paths and bare URLs; drops extras `[x]`, env markers after `;` and `--hash` options.
// Not read: requirements-dev.txt style names (the file dispatcher only matches requirements.txt),
// and the files that `-r` includes.

import type { ParseResult } from '@hwsw/core';
import { runParser } from './collector';
import { parseRequirement } from './pep508';

/** Parses a requirements.txt. `file` is only used to label errors. Never throws. */
export function parseRequirementsTxt(content: string, file = 'requirements.txt'): ParseResult {
  return runParser(file, content, (c, text) => {
    // Join "\"-continued lines, then handle one logical line at a time.
    const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.replace(/(^|\s)#.*$/, '').replace(/\s+--?[A-Za-z][\w-]*(?:[= ].*)?$/, '').trim();
      if (line === '') continue;
      if (line.startsWith('-')) continue; // -r, -e, -c, --index-url, ...
      if (/^(?:\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/|git\+)/.test(line) && !line.includes(' @ ')) continue; // path or bare URL
      const req = parseRequirement(line);
      if (!req) {
        c.error('unrecognised requirement line', raw);
        continue;
      }
      c.add('pypi', req.name, req.spec, false, req.direct ? { version: null } : {});
    }
  });
}

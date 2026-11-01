// Gemfile -> gem tags. A Gemfile is Ruby code, so this is a line scanner:
//   gem 'name'   gem "name", "~> 4.3"   gem 'name', '>= 1', '< 3'
// dev when inside `group :development / :test do ... end` or given group: / groups: options.
// git:, github:, path: gems keep their tag with version null.
// NOT read: gemspec, `gem` calls built from variables or split over several lines,
// gems added by `eval_gemfile` or conditionals' else branches (both branches are read).

import type { ParseResult } from '@hwsw/core';
import { runParser } from './collector';

const DEV_GROUP_RE = /:(?:development|test)\b|['"](?:development|test)['"]/;

/** Parses a Gemfile. `file` is only used to label errors. Never throws. */
export function parseGemfile(content: string, file = 'Gemfile'): ParseResult {
  return runParser(file, content, (c, text) => {
    // One entry per open block: true when it is a development/test group.
    const blocks: boolean[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/(^|\s)#.*$/, '$1').trim();
      if (line === '') continue;

      const group = /^group\s+(.*?)\s+do\b/.exec(line);
      if (group) {
        blocks.push(DEV_GROUP_RE.test(group[1]));
        continue;
      }
      if (/^end\b/.test(line)) {
        blocks.pop();
        continue;
      }
      // Any other block opener must be counted so its `end` does not close a group.
      const opensBlock = /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line) || /^(?:if|unless|case|begin|while|until)\b/.test(line);
      const gem = /^gem(?:\s+(.*))?$/.exec(line);
      if (!gem) {
        if (opensBlock) blocks.push(blocks.length > 0 && blocks[blocks.length - 1]);
        continue;
      }

      const args = gem[1] ?? '';
      const name = /^(['"])([^'"]+)\1/.exec(args);
      if (!name) {
        c.error('gem line without a quoted gem name', raw);
        continue;
      }
      let rest = args.slice(name[0].length);
      const constraints: string[] = [];
      for (;;) {
        const m = /^\s*,\s*(['"])([^'"]*)\1/.exec(rest);
        if (!m) break;
        constraints.push(m[2]);
        rest = rest.slice(m[0].length);
      }
      const inDevBlock = blocks.some(Boolean);
      const devOption = /\bgroups?\s*(?::|=>)\s*(.*)$/.exec(rest);
      const dev = inDevBlock || (devOption !== null && DEV_GROUP_RE.test(devOption[1]));
      const nonRegistry = /\b(?:git|github|gitlab|bitbucket|path)\s*(?::|=>)/.test(rest);
      c.add('gem', name[2], constraints.length > 0 ? constraints.join(', ') : null, dev, nonRegistry ? { version: null } : {});
      if (opensBlock) blocks.push(blocks.length > 0 && blocks[blocks.length - 1]);
    }
  });
}

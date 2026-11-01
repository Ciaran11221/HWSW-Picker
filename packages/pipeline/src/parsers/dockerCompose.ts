// docker-compose.yml / compose.yaml: services.<name>.image -> docker tags.
// A small indentation scanner, not a YAML parser, so no dependency is needed.
// NOT handled: images set through YAML anchors / merge keys (`<<: *common`), flow style
// (`services: { web: { image: x } }`), x-* extension fields, `${VAR}` images (parse error),
// multi-document files, `build:`-only services (no image, so no tag).

import type { ParseResult } from '@hwsw/core';
import { runParser } from './collector';
import { addImage } from './dockerImage';

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Parses a compose file. `file` is only used to label errors. Never throws. */
export function parseDockerCompose(content: string, file = 'docker-compose.yml'): ParseResult {
  return runParser(file, content, (c, text) => {
    const lines = text.split(/\r?\n/);
    if (lines.some((l) => /^ *\t/.test(l))) {
      c.error('tab used for indentation; YAML only allows spaces');
      return;
    }
    const start = lines.findIndex((l) => /^services\s*:/.test(l));
    if (start < 0) {
      if (text.trim() !== '') c.error('no top-level "services:" key found');
      return;
    }
    if (!/^services\s*:\s*(?:#.*)?$/.test(lines[start])) {
      c.error('"services:" is not written as a block mapping', lines[start]);
      return;
    }

    let serviceIndent = -1;
    let fieldIndent = -1;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || /^\s*#/.test(line)) continue;
      const indent = indentOf(line);
      if (indent === 0) break; // next top-level key
      if (serviceIndent < 0) serviceIndent = indent;
      if (indent === serviceIndent) {
        fieldIndent = -1; // a new service starts
        continue;
      }
      if (indent < serviceIndent) continue;
      if (fieldIndent < 0) fieldIndent = indent;
      if (indent !== fieldIndent) continue;
      const image = /^\s*image\s*:\s*(.*)$/.exec(line);
      if (!image) continue;
      const value = image[1].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value === '') {
        c.error('image has no value', line);
        continue;
      }
      addImage(c, value, false, line);
    }
  });
}

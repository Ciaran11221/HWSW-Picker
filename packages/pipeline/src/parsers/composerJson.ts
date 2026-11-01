// composer.json: require and require-dev -> composer tags.
// Platform requirements (php, ext-*, lib-*, ...) are not packages and are skipped.
// Not read: suggest, replace, provide, conflict.

import type { ParseResult } from '@hwsw/core';
import { parseJsonObject, runParser } from './collector';
import { isRecord } from './versions';

const PLATFORM_RE = /^(?:php(?:-(?:64bit|ipv6|zts|debug))?|hhvm|composer|composer-plugin-api|composer-runtime-api|(?:ext|lib)-.+)$/i;

/** Parses a composer.json. `file` is only used to label errors. Never throws. */
export function parseComposerJson(content: string, file = 'composer.json'): ParseResult {
  return runParser(file, content, (c, text) => {
    const doc = parseJsonObject(c, text);
    if (!doc) return;
    for (const [section, dev] of [['require', false], ['require-dev', true]] as const) {
      const deps = doc[section];
      if (deps === undefined) continue;
      if (!isRecord(deps)) {
        c.error(`"${section}" is not an object`);
        continue;
      }
      for (const [name, raw] of Object.entries(deps)) {
        if (PLATFORM_RE.test(name)) continue;
        if (!name.includes('/')) {
          c.error(`"${section}.${name}" is not a vendor/package name`);
          continue;
        }
        if (typeof raw !== 'string') {
          c.error(`"${section}.${name}" is not a string`, JSON.stringify(raw));
          c.add('composer', name, null, dev, { version: null });
          continue;
        }
        c.add('composer', name, raw, dev);
      }
    }
  });
}

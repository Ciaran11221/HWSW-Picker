// Cargo.toml -> cargo tags. Reads dependencies, build-dependencies, workspace.dependencies,
// and dev-dependencies (dev), at the top level and under target.*. Handles `name = "1"`,
// `name = { version = "1", ... }`, [dependencies.name] tables and `package = "real-name"` renames.
// git / path / workspace = true deps keep their tag with version null.
// Not read: [patch], [replace], [features], cargo `edition` / `rust-version`.

import type { ParseResult } from '@hwsw/core';
import { parse as parseToml } from 'smol-toml';
import { Collector, runParser } from './collector';
import { isRecord, tomlLine } from './versions';

function addTable(c: Collector, where: string, table: unknown, dev: boolean): void {
  if (table === undefined) return;
  if (!isRecord(table)) {
    c.error(`${where} is not a table`);
    return;
  }
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') {
      c.add('cargo', key, value, dev);
    } else if (isRecord(value)) {
      const name = typeof value.package === 'string' ? value.package : key;
      if (typeof value.version === 'string') c.add('cargo', name, value.version, dev);
      else c.add('cargo', name, null, dev, { version: null }); // git, path or workspace = true
    } else {
      c.error(`${where}.${key} is not a version string or table`);
    }
  }
}

/** Parses a Cargo.toml. `file` is only used to label errors. Never throws. */
export function parseCargoToml(content: string, file = 'Cargo.toml'): ParseResult {
  return runParser(file, content, (c, text) => {
    let doc: Record<string, unknown>;
    try {
      doc = parseToml(text) as Record<string, unknown>;
    } catch (e) {
      c.error('invalid TOML', tomlLine(e));
      return;
    }
    const sections = (root: Record<string, unknown>, prefix: string): void => {
      addTable(c, `${prefix}dependencies`, root.dependencies, false);
      addTable(c, `${prefix}build-dependencies`, root['build-dependencies'], false);
      addTable(c, `${prefix}dev-dependencies`, root['dev-dependencies'], true);
    };
    sections(doc, '');
    if (isRecord(doc.workspace)) addTable(c, 'workspace.dependencies', doc.workspace.dependencies, false);
    if (isRecord(doc.target)) {
      for (const [cfg, t] of Object.entries(doc.target)) {
        if (isRecord(t)) sections(t, `target.${cfg}.`);
      }
    }
  });
}

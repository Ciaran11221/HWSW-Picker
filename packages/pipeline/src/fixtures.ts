// Finds the golden manifest fixtures under corpus/manifests/ so the test and the
// `fixtures:update` script read them the same way.
//
// Layout: corpus/manifests/<format>/<case>.<original file name>      (the input)
//         corpus/manifests/<format>/<case>.expected.json             (its ParseResult)
// <case> has no dots; everything after the first dot is the file name the parser sees.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParseResult } from '@hwsw/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MANIFESTS_DIR = path.join(ROOT, 'corpus', 'manifests');

/** One golden fixture: an input manifest and where its expected output lives. */
export interface Fixture {
  /** Folder name under corpus/manifests/. */
  format: string;
  /** The part before the first dot in the file name. */
  caseName: string;
  /** The original file name the parser is given, e.g. `package.json` or `Dockerfile.dev`. */
  fileName: string;
  inputPath: string;
  expectedPath: string;
}

/** All fixtures, sorted by format then file name. */
export function listFixtures(dir: string = MANIFESTS_DIR): Fixture[] {
  const out: Fixture[] = [];
  if (!existsSync(dir)) return out;
  for (const format of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const base of readdirSync(path.join(dir, format)).sort()) {
      const dot = base.indexOf('.');
      if (dot <= 0) continue;
      const caseName = base.slice(0, dot);
      const fileName = base.slice(dot + 1);
      if (fileName === 'expected.json') continue;
      out.push({
        format,
        caseName,
        fileName,
        inputPath: path.join(dir, format, base),
        expectedPath: path.join(dir, format, `${caseName}.expected.json`),
      });
    }
  }
  return out;
}

/** The fixture input as text. */
export function readInput(f: Fixture): string {
  return readFileSync(f.inputPath, 'utf8');
}

/** The exact text written to an `.expected.json` file (2-space JSON, LF, trailing newline). */
export function renderExpected(result: ParseResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

// Loads and validates corpus/mistakes/*.json and renders corpus/mistakes/INDEX.md.
// Each past mistake names the test that guards it. loadMistakes checks the shape;
// guardProblem checks the guard's test file exists and contains the test name.
// Run through: npm run corpus:index (scripts/corpus-index.ts writes INDEX.md).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MISTAKES_DIR = path.join(ROOT, 'corpus', 'mistakes');
export const MISTAKES_INDEX_PATH = path.join(MISTAKES_DIR, 'INDEX.md');

export interface Mistake {
  /** Lowercase kebab-case; the entry file is named `<id>.json`. */
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  what_happened: string;
  rule: string;
  /** `<repo-relative test file> > <exact test name>`. */
  guard: string;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalise = (s: string) => s.replace(/\r\n/g, '\n');
const show = (v: unknown) => JSON.stringify(v) ?? String(v);

/** Splits `<file> > <test name>` at the first ` > `. Returns null when either side is empty. */
export function parseGuard(guard: string): { file: string; test: string } | null {
  const i = guard.indexOf(' > ');
  if (i < 0) return null;
  const file = guard.slice(0, i).trim();
  const test = guard.slice(i + 3).trim();
  if (file === '' || test === '') return null;
  return { file, test };
}

/** Validates a parsed entry object. Throws an Error naming the first problem and the file. */
export function validateMistake(json: unknown, fileName: string): Mistake {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`${fileName}: an entry must be a JSON object, got ${show(json)}`);
  }
  const raw = json as Record<string, unknown>;

  const id = raw.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`${fileName}: id must be lowercase kebab-case, got ${show(id)}`);
  }
  if (fileName !== `${id}.json`) {
    throw new Error(`${fileName}: file must be named "${id}.json" to match its id`);
  }

  const date = raw.date;
  const when = typeof date === 'string' && DATE_RE.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (when === null || Number.isNaN(when.getTime()) || when.toISOString().slice(0, 10) !== date) {
    throw new Error(`${fileName}: date must be a real YYYY-MM-DD date, got ${show(date)}`);
  }

  for (const key of ['what_happened', 'rule'] as const) {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value)) {
      throw new Error(`${fileName}: ${key} must be a non-empty single-line string, got ${show(value)}`);
    }
  }

  const guard = raw.guard;
  const parsed = typeof guard === 'string' ? parseGuard(guard) : null;
  if (parsed === null) {
    throw new Error(`${fileName}: guard must be "<test file> > <exact test name>", got ${show(guard)}`);
  }
  if (!/^tests\/.+\.test\.ts$/.test(parsed.file)) {
    throw new Error(`${fileName}: guard file must be a tests/*.test.ts path, got ${show(parsed.file)}`);
  }

  return {
    id,
    date,
    what_happened: raw.what_happened as string,
    rule: raw.rule as string,
    guard: guard as string,
  };
}

/**
 * Returns a problem message when the guard's test file is missing or does not contain the
 * test name, or null when the guard resolves. Paths are relative to the repo root.
 */
export function guardProblem(m: Mistake): string | null {
  const parsed = parseGuard(m.guard);
  if (parsed === null) return `${m.id}: guard "${m.guard}" is not "<file> > <test name>"`;
  const abs = path.join(ROOT, parsed.file);
  if (!existsSync(abs)) return `${m.id}: guard file "${parsed.file}" does not exist`;
  const text = normalise(readFileSync(abs, 'utf8'));
  if (!text.includes(parsed.test)) return `${m.id}: test "${parsed.test}" is not in ${parsed.file}`;
  return null;
}

/** Reads and validates every `*.json` entry. Throws naming the file on the first bad one. */
export function loadMistakes(dir: string = MISTAKES_DIR): Mistake[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      try {
        return validateMistake(JSON.parse(readFileSync(path.join(dir, file), 'utf8')), file);
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    });
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** Markdown index of mistakes, sorted by date then id. Output uses LF line endings. */
export function renderMistakesIndex(mistakes: readonly Mistake[]): string {
  const sorted = [...mistakes].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const rows = sorted.map(
    (m) => `| ${cell(m.id)} | ${m.date} | ${cell(m.what_happened)} | ${cell(m.rule)} | ${cell(m.guard)} |`,
  );
  return [
    '# Mistakes corpus',
    '',
    'Generated by `npm run corpus:index` from `corpus/mistakes/*.json`. Do not edit by hand.',
    '',
    `${mistakes.length} mistakes. Each guard names the test that fails if the mistake comes back.`,
    '',
    '| id | date | what happened | rule | guard |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

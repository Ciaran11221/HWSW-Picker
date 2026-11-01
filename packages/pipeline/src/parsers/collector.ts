// Collects tags and errors for one manifest file, dedupes tags, and guarantees
// a parser never throws: runParser turns any exception into a 'parse' error.

import { isTagId, type Ecosystem, type ManifestTag, type ParseResult, type PipelineError } from '@hwsw/core';
import { errMessage, excerpt, lowestVersion } from './versions';

/** Accumulates the result for one file. */
export class Collector {
  readonly tags: ManifestTag[] = [];
  readonly errors: PipelineError[] = [];
  private readonly seen = new Set<string>();

  constructor(readonly file: string) {}

  /**
   * Adds a tag. The package name is lowercased and checked with `isTagId`; a bad
   * name becomes a 'parse' error. A tag seen twice keeps the first, unless only the later one has a version.
   * `opts.version` overrides version extraction (use null for git / path deps).
   */
  add(
    ecosystem: Ecosystem,
    pkg: string,
    spec: string | null,
    dev: boolean,
    opts: { version?: string | null } = {},
  ): void {
    const id = `${ecosystem}:${pkg.trim().toLowerCase()}`;
    if (!isTagId(id)) {
      this.error(`invalid ${ecosystem} package name`, pkg);
      return;
    }
    const cleanSpec = spec === null || spec.trim() === '' ? null : spec.trim();
    const version = opts.version !== undefined ? opts.version : lowestVersion(cleanSpec);
    if (this.seen.has(id)) {
      // Keep the first, unless it had no version and this one has.
      const first = this.tags.find((t) => t.tag === id);
      if (first && first.version === null && version !== null) {
        first.spec = cleanSpec;
        first.version = version;
      }
      return;
    }
    this.seen.add(id);
    this.tags.push({ tag: id, spec: cleanSpec, version, dev });
  }

  /** Records a 'parse' error for this file. */
  error(message: string, detail?: string): void {
    const e: PipelineError = { kind: 'parse', message, file: this.file };
    if (detail !== undefined && detail !== '') e.detail = excerpt(detail);
    this.errors.push(e);
  }

  /** The finished result. */
  result(): ParseResult {
    return { tags: this.tags, errors: this.errors };
  }
}

/** Runs `fn` on a fresh Collector. Any exception (or non-string content) becomes a 'parse' error. */
export function runParser(file: string, content: unknown, fn: (c: Collector, text: string) => void): ParseResult {
  const c = new Collector(typeof file === 'string' ? file : String(file));
  try {
    if (typeof content !== 'string') {
      c.error('manifest content is not text');
    } else {
      fn(c, content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
    }
  } catch (e) {
    c.error(`unexpected parser failure: ${errMessage(e)}`);
  }
  return c.result();
}

/** JSON.parse that records a 'parse' error and returns undefined on bad input or a non-object root. */
export function parseJsonObject(c: Collector, text: string): Record<string, unknown> | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    // V8's wording changes between releases; keep the message fixed and give only the line.
    const pos = /position (\d+)/.exec(errMessage(e));
    const line = pos ? text.slice(0, Number(pos[1])).split('\n').length : null;
    c.error('invalid JSON', line === null ? undefined : `near line ${line}`);
    return undefined;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    c.error('expected a JSON object at the top level');
    return undefined;
  }
  return doc as Record<string, unknown>;
}

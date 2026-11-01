// Shared types for HWSW-Picker: tag ids, tag families, repo records and
// out-of-date flags. Used by the pipeline (writes the dataset) and the site (reads it).

/** Package ecosystems a tag can come from. */
export const ECOSYSTEMS = ['npm', 'pypi', 'maven', 'go', 'cargo', 'docker', 'composer', 'gem'] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

/** Family kinds, from language down to infrastructure. */
export const FAMILY_KINDS = ['language', 'runtime', 'framework', 'library', 'database', 'tool', 'infra'] as const;
export type FamilyKind = (typeof FAMILY_KINDS)[number];

/** A tag id: `<ecosystem>:<package>`, all lowercase. e.g. `npm:react`, `docker:node`. */
export type TagId = `${Ecosystem}:${string}`;

/**
 * A group of tags that are one product (e.g. npm:react, npm:react-dom, npm:@types/react).
 * A tag belongs to at most one family, so it is counted once in the percentages.
 */
export interface Family {
  /** Lowercase kebab-case; the family file is named `<id>.json`. */
  id: string;
  name: string;
  kind: FamilyKind;
  /** Non-empty. */
  members: TagId[];
  /** endoflife.date product id, or null when endoflife.date has no product for it. */
  eol: string | null;
}

/** One analysed GitHub repo and the tags its manifests declare. */
export interface RepoRecord {
  fullName: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  stars: number;
  contributors: number;
  primaryLanguage: string | null;
  tags: { tag: TagId; version: string | null }[];
}

export type OutOfDateReason = 'eol' | 'deprecated' | 'yanked' | 'stale';

/** Why a tag version is flagged out of date, with the source detail. */
export interface OutOfDate {
  reason: OutOfDateReason;
  detail: string;
}

const FAMILY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * True when `s` is `<ecosystem>:<package>` with a known ecosystem, a non-empty
 * package, and no uppercase letters or whitespace.
 */
export function isTagId(s: unknown): s is TagId {
  if (typeof s !== 'string') return false;
  const colon = s.indexOf(':');
  if (colon < 0) return false;
  const ecosystem = s.slice(0, colon);
  const pkg = s.slice(colon + 1);
  return (ECOSYSTEMS as readonly string[]).includes(ecosystem)
    && pkg.length > 0
    && pkg === pkg.toLowerCase()
    && !/\s/.test(pkg);
}

function show(v: unknown): string {
  if (v === undefined) return 'undefined';
  return JSON.stringify(v) ?? String(v);
}

/** Validates a parsed family JSON object. Throws an Error naming the first problem found. */
export function parseFamily(json: unknown): Family {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`parseFamily: a family must be a JSON object, got ${show(json)}`);
  }
  const raw = json as Record<string, unknown>;

  const id = raw.id;
  if (typeof id !== 'string' || !FAMILY_ID_RE.test(id)) {
    throw new Error(`parseFamily: id must be lowercase kebab-case (e.g. "react"), got ${show(id)}`);
  }
  const at = `family "${id}"`;

  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${at}: name must be a non-empty string, got ${show(name)}`);
  }

  const kind = raw.kind;
  if (typeof kind !== 'string' || !(FAMILY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`${at}: kind must be one of ${FAMILY_KINDS.join(', ')}, got ${show(kind)}`);
  }

  const members = raw.members;
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(`${at}: members must be a non-empty array of tag ids`);
  }
  members.forEach((m: unknown, i: number) => {
    if (!isTagId(m)) {
      throw new Error(`${at}: members[${i}] ${show(m)} is not a tag id (<ecosystem>:<lowercase package>, ecosystem one of ${ECOSYSTEMS.join(', ')})`);
    }
  });
  const seen = new Set<string>();
  for (const m of members as string[]) {
    if (seen.has(m)) throw new Error(`${at}: member ${show(m)} is listed twice`);
    seen.add(m);
  }

  const eol = raw.eol;
  if (eol !== null && (typeof eol !== 'string' || eol.trim() === '')) {
    throw new Error(`${at}: eol must be an endoflife.date product id or null, got ${show(eol)}`);
  }

  return { id, name, kind: kind as FamilyKind, members: members as TagId[], eol };
}

/** Where in the pipeline a recoverable problem happened. */
export type PipelineErrorKind = 'fetch' | 'rate_limit' | 'parse' | 'eol_lookup' | 'registry';

/**
 * A recoverable problem. The pipeline records these and keeps going, so one bad
 * repo or file cannot kill a 36k-repo run.
 */
export interface PipelineError {
  kind: PipelineErrorKind;
  message: string;
  /** `owner/name` of the repo being processed, when known. */
  repo?: string;
  /** Manifest file name or path the error came from. */
  file?: string;
  /** Extra context: the offending line, a status code, etc. */
  detail?: string;
}

/** One dependency read from a manifest. */
export interface ManifestTag {
  tag: TagId;
  /** The raw constraint as written (`^18.2.0`, `>=4.2,<5`), or null when none is written. */
  spec: string | null;
  /** Lowest concrete version in `spec` (`18.2.0`, `4.2`), or null for `*`, `latest`, git/url/path deps. */
  version: string | null;
  /** True for devDependencies, dev/test groups and test scope. */
  dev: boolean;
}

/** What a manifest parser returns: the tags it could read, plus everything it could not. */
export interface ParseResult {
  tags: ManifestTag[];
  errors: PipelineError[];
}

// Version helpers shared by the manifest parsers. Pure string work, never throws.

/**
 * Lowest concrete version named by a dependency constraint, best effort.
 *
 * - `^18.2.0` -> `18.2.0`, `>=4.2,<5` -> `4.2`, `~> 4.3` -> `4.3`, `1.x` -> `1`
 * - `^15 || ^16` -> `15` (first alternative); `[1.0,2.0)` -> `1.0`
 * - `v1.9.1+incompatible` -> `1.9.1`
 * - null for `*`, `latest`, upper-bound-only (`<5`), `${property}`, and git / url / path / workspace deps
 */
export function lowestVersion(spec: string | null | undefined): string | null {
  if (typeof spec !== 'string') return null;
  let s = spec.trim();
  if (s === '') return null;

  const alias = /^npm:[^@]*@(.+)$/.exec(s); // npm alias: "npm:other@^1.2"
  if (alias) s = alias[1].trim();

  if (/^dev-/i.test(s)) return null; // Composer branch constraint, also with "as 1.0.x-dev" aliases
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // git+https:, file:, link:, workspace:, github:
  if (s.includes('/')) return null; // "user/repo" shorthand, paths, urls

  if (s.startsWith('[') || s.startsWith('(')) { // Maven range
    const lower = s.slice(1).split(',')[0].trim().replace(/[\])]+$/, '');
    if (lower === '') return null; // "(,1.0]" has no lower bound
    s = lower;
  }

  s = s.replace(/([~^<>=!]+)\s+/g, '$1'); // "~> 4.3" -> "~>4.3"
  for (const comparator of s.split(/\s*\|\|?\s*|[\s,]+/)) {
    if (comparator === '' || /^[<!]/.test(comparator)) continue;
    const c = comparator.replace(/^(?:~>|~=|===|==|>=|>|=|\^|~)+/, '').replace(/^v(?=\d)/i, '');
    const m = /^(\d+(?:\.\d+)*)(\.[xX*+])?([-+._A-Za-z][0-9A-Za-z.+_-]*)?/.exec(c);
    if (!m) continue;
    // "1.x" and "1.+" stop at the wildcard; a suffix after a wildcard ("1.0.x-dev") is dropped.
    if (m[2]) return m[1];
    return (m[1] + (m[3] ?? '')).replace(/\+.*$/, '');
  }
  return null;
}

/** PEP 503 normalisation: lowercase, runs of `-`, `_`, `.` become one `-`. */
export function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** One-line, length-capped excerpt of an offending input, for `PipelineError.detail`. */
export function excerpt(s: string, max = 160): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}...` : one;
}

/** True for a plain object (not null, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** First line of an Error message, so library parse errors stay short and stable. */
export function errMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0].trim();
}

/** `line N` from a smol-toml error, or undefined. Library wording is kept out of error messages so fixtures stay stable. */
export function tomlLine(e: unknown): string | undefined {
  const line = (e as { line?: unknown } | null)?.line;
  return typeof line === 'number' ? `line ${line}` : undefined;
}

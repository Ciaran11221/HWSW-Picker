// Shared by requirements.txt and pyproject.toml: reads one PEP 508 requirement
// string ("Django[argon2]>=4.2,<5 ; python_version >= '3.9'").

import { normalizePypiName } from './versions';

/** A requirement split into its parts. `url` is set for `name @ url` direct references. */
export interface Requirement {
  /** PEP 503 normalised name. */
  name: string;
  /** Constraint with whitespace removed (`>=4.2,<5`), or the url for direct references, or null. */
  spec: string | null;
  /** True when the requirement is a direct reference (no version can be read). */
  direct: boolean;
}

/**
 * Parses one requirement. Extras `[x]` and environment markers after `;` are dropped.
 * Returns null when the text is not a requirement.
 */
export function parseRequirement(text: string): Requirement | null {
  const noMarker = text.split(';')[0].trim();
  const nameMatch = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(noMarker);
  if (!nameMatch) return null;
  let rest = noMarker.slice(nameMatch[0].length).trim();
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return null;
    rest = rest.slice(close + 1).trim();
  }
  const name = normalizePypiName(nameMatch[0].replace(/[._-]+$/, ''));
  if (rest === '') return { name, spec: null, direct: false };
  if (rest.startsWith('@')) {
    const url = rest.slice(1).trim();
    return { name, spec: url === '' ? null : url, direct: true };
  }
  if (!/^[<>=!~(]/.test(rest)) return null;
  const spec = rest.replace(/[\s()]+/g, '');
  if (!/^(?:(?:===|==|~=|!=|<=|>=|<|>)[A-Za-z0-9.*+!_-]+,?)+$/.test(spec)) return null;
  return { name, spec: spec === '' ? null : spec, direct: false };
}

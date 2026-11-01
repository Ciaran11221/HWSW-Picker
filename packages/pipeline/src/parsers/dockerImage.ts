// Shared by Dockerfile and docker-compose: turns an image reference into a docker tag.

import type { Collector } from './collector';

/** Version from an image tag: "21-alpine" -> "21", "3.11-slim" -> "3.11", "latest" -> null. */
export function dockerTagVersion(tag: string | null): string | null {
  if (tag === null) return null;
  const m = /^v?(\d+(?:\.\d+)*)/.exec(tag);
  return m ? m[1] : null;
}

/**
 * Adds `docker:<image>` for an image reference such as `ghcr.io/org/app:1.2@sha256:...`.
 * The registry host and a leading `library/` are dropped; the part after `:` is the tag.
 * A reference that uses a variable (`$X`, `${X}`) cannot be resolved: it becomes a 'parse' error.
 */
export function addImage(c: Collector, ref: string, dev: boolean, original: string): void {
  if (ref.includes('$')) {
    c.error('image reference uses a variable ($ARG or ${VAR}) and cannot be resolved', original);
    return;
  }
  const noDigest = ref.split('@')[0];
  const parts = noDigest.split('/');
  if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === 'localhost')) parts.shift(); // registry host
  if (parts.length === 2 && parts[0] === 'library') parts.shift();
  const last = parts[parts.length - 1];
  const colon = last.indexOf(':');
  const tag = colon >= 0 ? last.slice(colon + 1) : null;
  parts[parts.length - 1] = colon >= 0 ? last.slice(0, colon) : last;
  const name = parts.join('/');
  if (name === '') {
    c.error('empty image reference', original);
    return;
  }
  c.add('docker', name, tag === '' ? null : tag, dev, { version: dockerTagVersion(tag) });
}

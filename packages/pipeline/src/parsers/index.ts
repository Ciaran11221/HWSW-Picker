// Picks the right manifest parser from a file name. Every parser is a pure function
// (content -> ParseResult) that never throws.

import type { ParseResult } from '@hwsw/core';
import { parseCargoToml } from './cargoToml';
import { parseComposerJson } from './composerJson';
import { parseDockerCompose } from './dockerCompose';
import { parseDockerfile } from './dockerfile';
import { parseGemfile } from './gemfile';
import { parseGoMod } from './goMod';
import { parseGradle } from './gradle';
import { parsePackageJson } from './packageJson';
import { parsePomXml } from './pomXml';
import { parsePyproject } from './pyproject';
import { parseRequirementsTxt } from './requirementsTxt';

/** The manifest formats we can read. Also the folder names under `corpus/manifests/`. */
export const MANIFEST_FORMATS = [
  'package-json', 'requirements-txt', 'pyproject', 'pom-xml', 'gradle', 'go-mod',
  'cargo-toml', 'composer-json', 'gemfile', 'dockerfile', 'docker-compose',
] as const;
export type ManifestFormat = (typeof MANIFEST_FORMATS)[number];

const PARSERS: Record<ManifestFormat, (content: string, file: string) => ParseResult> = {
  'package-json': parsePackageJson,
  'requirements-txt': parseRequirementsTxt,
  pyproject: parsePyproject,
  'pom-xml': parsePomXml,
  gradle: parseGradle,
  'go-mod': parseGoMod,
  'cargo-toml': parseCargoToml,
  'composer-json': parseComposerJson,
  gemfile: parseGemfile,
  dockerfile: parseDockerfile,
  'docker-compose': parseDockerCompose,
};

/** Format for a file name or path (basename, case-insensitive), or null for files we do not read. */
export function detectFormat(fileName: string): ManifestFormat | null {
  if (typeof fileName !== 'string') return null;
  const base = (fileName.split(/[\\/]/).pop() ?? '').toLowerCase();
  switch (base) {
    case 'package.json': return 'package-json';
    case 'requirements.txt': return 'requirements-txt';
    case 'pyproject.toml': return 'pyproject';
    case 'pom.xml': return 'pom-xml';
    case 'build.gradle':
    case 'build.gradle.kts': return 'gradle';
    case 'go.mod': return 'go-mod';
    case 'cargo.toml': return 'cargo-toml';
    case 'composer.json': return 'composer-json';
    case 'gemfile': return 'gemfile';
    case 'docker-compose.yml':
    case 'docker-compose.yaml':
    case 'compose.yml':
    case 'compose.yaml': return 'docker-compose';
    default: return base === 'dockerfile' || base.startsWith('dockerfile.') ? 'dockerfile' : null;
  }
}

/**
 * Parses one manifest, choosing the parser by file name. An unknown file gives an empty
 * result with no error. Never throws: bad input returns what could be read plus errors.
 * `fileName` is copied into each error's `file`.
 */
export function parseManifest(fileName: string, content: string): ParseResult {
  try {
    const format = detectFormat(fileName);
    if (format === null) return { tags: [], errors: [] };
    return PARSERS[format](content, fileName);
  } catch (e) {
    // Parsers already catch their own failures; this is the last line of defence.
    const message = e instanceof Error ? e.message : String(e);
    return { tags: [], errors: [{ kind: 'parse', message: `unexpected parser failure: ${message.split('\n')[0]}`, file: String(fileName) }] };
  }
}

export { lowestVersion, normalizePypiName } from './versions';

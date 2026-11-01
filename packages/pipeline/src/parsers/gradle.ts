// build.gradle / build.gradle.kts -> maven:<group>:<artifact> tags. Gradle files are code, so
// this is a line scanner, not an evaluator. Reads:
//   implementation 'g:a:v'   implementation("g:a:v")   implementation(platform("g:a:v"))
//   implementation group: 'g', name: 'a', version: 'v'
// for api / implementation / compile* / runtime* / annotationProcessor / kapt / ksp and
// their test* / androidTest* forms (those are dev).
// NOT read (skipped silently): version-catalog refs (libs.x.y), project(":x"), files(...),
// plugins {} blocks, buildscript classpath, variables used as the whole dependency.

import type { ParseResult } from '@hwsw/core';
import { Collector, runParser } from './collector';

const BASE_CONFIGS = new Set([
  'api', 'implementation', 'compile', 'compileOnly', 'runtime', 'runtimeOnly',
  'annotationProcessor', 'kapt', 'ksp', 'developmentOnly', 'providedCompile', 'providedRuntime',
]);
const PREFIXED_CONFIG_RE = /^(?:test|androidTest|testFixtures|integrationTest|functionalTest|debug|release)(?:Api|Implementation|Compile|CompileOnly|Runtime|RuntimeOnly|AnnotationProcessor)$|^(?:kaptTest|kspTest|kaptAndroidTest|kspAndroidTest)$/;
const DEV_CONFIG_RE = /^(?:test|androidTest|integrationTest|functionalTest|kaptTest|kspTest|kaptAndroidTest|kspAndroidTest)/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function addCoordinate(c: Collector, coordinate: string, dev: boolean, line: string): void {
  const parts = coordinate.split(':');
  const group = parts[0]?.trim();
  const artifact = parts[1]?.trim();
  if (parts.length < 2 || !group || !artifact) {
    c.error('dependency string is not group:artifact[:version]', line);
    return;
  }
  const version = parts[2]?.replace(/@.*$/, '').trim() || null; // "1.2@aar" -> "1.2"
  c.add('maven', `${group}:${artifact}`, version, dev);
}

/** Parses a build.gradle or build.gradle.kts. `file` is only used to label errors. Never throws. */
export function parseGradle(content: string, file = 'build.gradle'): ParseResult {
  return runParser(file, content, (c, src) => {
    const code = stripComments(src);

    // A truncated or damaged file shows up as unbalanced braces (string contents ignored).
    const bare = code.replace(/(['"])(?:(?!\1)[^\r\n])*\1/g, '""');
    const open = (bare.match(/\{/g) ?? []).length;
    const close = (bare.match(/\}/g) ?? []).length;
    if (open !== close) c.error(`unbalanced braces (${open} open, ${close} close); file may be truncated`);

    for (const line of code.split(/\r?\n/)) {
      const head = /^\s*([A-Za-z][A-Za-z0-9]*)\s*(.*)$/.exec(line);
      if (!head) continue;
      const config = head[1];
      if (!BASE_CONFIGS.has(config) && !PREFIXED_CONFIG_RE.test(config)) continue;
      const dev = DEV_CONFIG_RE.test(config);

      let rest = head[2].trim();
      rest = rest.replace(/^\(\s*/, '').replace(/^(?:enforcedPlatform|platform)\s*\(\s*/, '');
      const brace = rest.indexOf('{');
      if (brace >= 0) rest = rest.slice(0, brace); // exclude(...) blocks and closures

      const mapStyle = /^group\s*[:=]\s*(['"])([^'"]+)\1\s*,\s*name\s*[:=]\s*(['"])([^'"]+)\3(?:\s*,\s*version\s*[:=]\s*(['"])([^'"]*)\5)?/.exec(rest);
      if (mapStyle) {
        c.add('maven', `${mapStyle[2]}:${mapStyle[4]}`, mapStyle[6] ?? null, dev);
        continue;
      }
      if (!/^['"]/.test(rest)) continue; // libs.x.y, project(...), files(...), variables

      for (const m of rest.matchAll(/(['"])([^'"\r\n]*)\1/g)) addCoordinate(c, m[2], dev, line);
    }
  });
}

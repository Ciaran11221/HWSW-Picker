// pom.xml: project/dependencies/dependency -> maven:<groupId>:<artifactId> tags.
// Scope `test` -> dev. `${property}` in group, artifact or version is resolved from
// <properties>, project.version / groupId and the parent when possible; versions missing
// on a dependency are taken from <dependencyManagement> when listed there.
// Not read: <profiles>, <build><plugins>, <modules>, parent POMs and BOM imports (no network).

import type { ParseResult } from '@hwsw/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Collector, runParser } from './collector';
import { errMessage, isRecord } from './versions';

type Rec = Record<string, unknown>;

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function list(v: unknown): Rec[] {
  const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return arr.filter(isRecord);
}

function buildProperties(project: Rec): Map<string, string> {
  const props = new Map<string, string>();
  const parent = isRecord(project.parent) ? project.parent : {};
  const set = (k: string, v: unknown): void => {
    const t = text(v);
    if (t !== null) props.set(k, t);
  };
  set('project.parent.version', parent.version);
  set('project.parent.groupId', parent.groupId);
  set('project.groupId', project.groupId ?? parent.groupId);
  set('project.artifactId', project.artifactId);
  set('project.version', project.version ?? parent.version);
  set('pom.version', project.version ?? parent.version);
  set('version', project.version ?? parent.version);
  if (isRecord(project.properties)) {
    for (const [k, v] of Object.entries(project.properties)) set(k, v);
  }
  return props;
}

function resolve(value: string, props: Map<string, string>): string {
  let out = value;
  for (let i = 0; i < 5 && out.includes('${'); i++) {
    out = out.replace(/\$\{([^}]+)\}/g, (whole, key: string) => props.get(key.trim()) ?? whole);
  }
  return out;
}

/** Parses a pom.xml. `file` is only used to label errors. Never throws. */
export function parsePomXml(content: string, file = 'pom.xml'): ParseResult {
  return runParser(file, content, (c: Collector, src) => {
    const valid = XMLValidator.validate(src);
    if (valid !== true) {
      c.error(`invalid XML (${valid.err.code})`, `line ${valid.err.line}`);
      return;
    }
    let doc: unknown;
    try {
      doc = new XMLParser({
        ignoreAttributes: true,
        removeNSPrefix: true,
        parseTagValue: false,
        processEntities: true,
      }).parse(src);
    } catch (e) {
      c.error('invalid XML', errMessage(e));
      return;
    }
    const project = isRecord(doc) && isRecord(doc.project) ? doc.project : null;
    if (!project) {
      c.error('no <project> element found');
      return;
    }
    const props = buildProperties(project);

    // Versions pinned in dependencyManagement fill in dependencies that omit <version>.
    const managed = new Map<string, string>();
    const mgmt = isRecord(project.dependencyManagement) ? project.dependencyManagement : {};
    const mgmtDeps = isRecord(mgmt.dependencies) ? mgmt.dependencies : {};
    for (const d of list(mgmtDeps.dependency)) {
      const g = text(d.groupId);
      const a = text(d.artifactId);
      const v = text(d.version);
      if (g && a && v) managed.set(`${resolve(g, props)}:${resolve(a, props)}`, resolve(v, props));
    }

    const depsBlock = project.dependencies;
    if (depsBlock === undefined) return;
    if (!isRecord(depsBlock)) {
      c.error('<dependencies> has no <dependency> children');
      return;
    }
    for (const d of list(depsBlock.dependency)) {
      const g = text(d.groupId);
      const a = text(d.artifactId);
      if (!g || !a) {
        c.error('<dependency> is missing groupId or artifactId', JSON.stringify(d));
        continue;
      }
      const group = resolve(g, props);
      const artifact = resolve(a, props);
      const v = text(d.version);
      const spec = v !== null ? resolve(v, props) : managed.get(`${group}:${artifact}`) ?? null;
      c.add('maven', `${group}:${artifact}`, spec, text(d.scope) === 'test');
    }
  });
}

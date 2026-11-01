// pyproject.toml -> pypi tags. Reads:
//   PEP 621  project.dependencies, project.optional-dependencies (dev-like group names -> dev)
//   PEP 735  dependency-groups (all dev)
//   uv       tool.uv.dev-dependencies (dev)
//   Poetry   tool.poetry.dependencies (minus python), tool.poetry.group.*.dependencies (dev),
//            tool.poetry.dev-dependencies (dev)
// Not read: build-system.requires, tool.pdm, tool.hatch environments, include-group entries.

import type { ParseResult } from '@hwsw/core';
import { parse as parseToml } from 'smol-toml';
import { Collector, runParser } from './collector';
import { parseRequirement } from './pep508';
import { isRecord, normalizePypiName, tomlLine } from './versions';

const DEV_GROUP_RE = /^(?:dev|develop|development|test|tests|testing|lint|linting|docs?|typing|types|ci|qa|style|format)$/i;

function addRequirementList(c: Collector, where: string, list: unknown, dev: boolean): void {
  if (!Array.isArray(list)) {
    c.error(`${where} is not an array`);
    return;
  }
  for (const item of list) {
    if (typeof item !== 'string') {
      // PEP 735 { include-group = "..." } tables point at other groups; nothing to read.
      if (!isRecord(item)) c.error(`${where} has a non-string entry`, JSON.stringify(item));
      continue;
    }
    const req = parseRequirement(item);
    if (!req) {
      c.error(`unrecognised requirement in ${where}`, item);
      continue;
    }
    c.add('pypi', req.name, req.spec, dev, req.direct ? { version: null } : {});
  }
}

function addPoetryTable(c: Collector, where: string, table: unknown, dev: boolean): void {
  if (!isRecord(table)) {
    c.error(`${where} is not a table`);
    return;
  }
  for (const [name, value] of Object.entries(table)) {
    if (normalizePypiName(name) === 'python') continue;
    // Several constraints for one package come as an array of tables; the first is used.
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === 'string') {
      c.add('pypi', normalizePypiName(name), v, dev);
    } else if (isRecord(v)) {
      if (typeof v.version === 'string') {
        c.add('pypi', normalizePypiName(name), v.version, dev);
      } else {
        const src = ['git', 'url', 'path'].map((k) => v[k]).find((x) => typeof x === 'string');
        c.add('pypi', normalizePypiName(name), typeof src === 'string' ? src : null, dev, { version: null });
      }
    } else {
      c.error(`${where}.${name} is not a version string or table`);
    }
  }
}

/** Parses a pyproject.toml. `file` is only used to label errors. Never throws. */
export function parsePyproject(content: string, file = 'pyproject.toml'): ParseResult {
  return runParser(file, content, (c, text) => {
    let doc: Record<string, unknown>;
    try {
      doc = parseToml(text) as Record<string, unknown>;
    } catch (e) {
      c.error('invalid TOML', tomlLine(e));
      return;
    }

    const project = doc.project;
    if (isRecord(project)) {
      if (project.dependencies !== undefined) addRequirementList(c, 'project.dependencies', project.dependencies, false);
      const optional = project['optional-dependencies'];
      if (optional !== undefined) {
        if (!isRecord(optional)) c.error('project.optional-dependencies is not a table');
        else for (const [group, list] of Object.entries(optional)) {
          addRequirementList(c, `project.optional-dependencies.${group}`, list, DEV_GROUP_RE.test(group));
        }
      }
    }

    const groups = doc['dependency-groups'];
    if (isRecord(groups)) {
      for (const [group, list] of Object.entries(groups)) addRequirementList(c, `dependency-groups.${group}`, list, true);
    }

    const tool = isRecord(doc.tool) ? doc.tool : {};
    const uv = tool.uv;
    if (isRecord(uv) && uv['dev-dependencies'] !== undefined) {
      addRequirementList(c, 'tool.uv.dev-dependencies', uv['dev-dependencies'], true);
    }

    const poetry = tool.poetry;
    if (isRecord(poetry)) {
      if (poetry.dependencies !== undefined) addPoetryTable(c, 'tool.poetry.dependencies', poetry.dependencies, false);
      const group = poetry.group;
      if (isRecord(group)) {
        for (const [name, g] of Object.entries(group)) {
          if (isRecord(g) && g.dependencies !== undefined) {
            addPoetryTable(c, `tool.poetry.group.${name}.dependencies`, g.dependencies, true);
          }
        }
      }
      if (poetry['dev-dependencies'] !== undefined) {
        addPoetryTable(c, 'tool.poetry.dev-dependencies', poetry['dev-dependencies'], true);
      }
    }
  });
}

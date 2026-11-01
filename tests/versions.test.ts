// Unit tests for lowestVersion: the lowest concrete version in an npm / PEP 440 / Maven /
// Go / Cargo / Composer / Gem constraint, best effort.

import { describe, expect, it } from 'vitest';
import { lowestVersion, normalizePypiName } from '../packages/pipeline/src/parsers/versions';

describe('lowestVersion', () => {
  it.each([
    // npm
    ['^18.2.0', '18.2.0'],
    ['~1.2.3', '1.2.3'],
    ['14.2.35', '14.2.35'],
    ['^18', '18'],
    ['>=3.5.0 <4', '3.5.0'],
    ['^15.0.0 || ^16.0.0', '15.0.0'],
    ['1.2.3 - 2.0.0', '1.2.3'],
    ['4.x', '4'],
    ['1.0.0-beta.2', '1.0.0-beta.2'],
    ['npm:string-width@^4.2.0', '4.2.0'],
    ['*', null],
    ['latest', null],
    ['next', null],
    ['', null],
    ['<2.0.0', null],
    ['workspace:*', null],
    ['github:someone/repo#main', null],
    ['git+https://example.invalid/x.git', null],
    ['file:../local', null],
    ['someone/repo', null],
    // PEP 440
    ['>=4.2,<5', '4.2'],
    ['==3.1.1', '3.1.1'],
    ['~=1.4.2', '1.4.2'],
    ['==2.0.*', '2.0'],
    ['>=2.8,!=2.8.1', '2.8'],
    ['!=1.5', null],
    ['<9', null],
    // Maven
    ['3.3.1', '3.3.1'],
    ['[2.11,3.0)', '2.11'],
    ['[1.0]', '1.0'],
    ['(,1.0]', null],
    ['33.2.1-jre', '33.2.1-jre'],
    ['${jackson.version}', null],
    ['5.+', '5'],
    // Go
    ['v1.9.1', '1.9.1'],
    ['v2.7.0+incompatible', '2.7.0'],
    ['v0.0.0-20240102030405-abcdef123456', '0.0.0-20240102030405-abcdef123456'],
    // Cargo
    ['1', '1'],
    ['=0.8.5', '0.8.5'],
    ['>=1.35, <2', '1.35'],
    // Composer
    ['^5.4|^6.0', '5.4'],
    ['2.17.*', '2.17'],
    ['dev-main', null],
    ['dev-main as 1.0.x-dev', null],
    ['^1.2@dev', '1.2'],
    // Gem
    ['~> 4.3', '4.3'],
    ['>= 3.0, < 5', '3.0'],
  ] as [string, string | null][])('%j -> %j', (spec, expected) => {
    expect(lowestVersion(spec)).toBe(expected);
  });

  it('returns null for non-strings', () => {
    expect(lowestVersion(null)).toBeNull();
    expect(lowestVersion(undefined)).toBeNull();
    expect(lowestVersion(42 as unknown as string)).toBeNull();
  });
});

describe('normalizePypiName', () => {
  it.each([
    ['Flask_SQLAlchemy', 'flask-sqlalchemy'],
    ['my.pkg_name', 'my-pkg-name'],
    ['zope.interface', 'zope-interface'],
    ['a__b--c..d', 'a-b-c-d'],
  ])('%s -> %s', (name, expected) => {
    expect(normalizePypiName(name)).toBe(expected);
  });
});

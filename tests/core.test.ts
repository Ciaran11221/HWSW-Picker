import { describe, expect, it } from 'vitest';
import { isTagId, parseFamily } from '@hwsw/core';

describe('isTagId', () => {
  it.each(['npm:react', 'npm:@types/react', 'docker:node', 'maven:org.junit:junit', 'pypi:numpy'])(
    'accepts %s',
    (s) => {
      expect(isTagId(s)).toBe(true);
    },
  );

  it.each([
    ['no colon', 'react'],
    ['unknown ecosystem', 'yarn:react'],
    ['uppercase ecosystem', 'NPM:react'],
    ['uppercase package', 'npm:React'],
    ['empty package', 'npm:'],
    ['whitespace in package', 'npm:react dom'],
    ['not a string', 42],
  ])('rejects %s', (_label, value) => {
    expect(isTagId(value)).toBe(false);
  });
});

describe('parseFamily', () => {
  const good = {
    id: 'react',
    name: 'React',
    kind: 'library',
    members: ['npm:react', 'npm:react-dom'],
    eol: 'react',
  };

  it('accepts a valid family and returns it', () => {
    expect(parseFamily(good)).toEqual(good);
  });

  it('accepts eol null', () => {
    expect(parseFamily({ ...good, eol: null }).eol).toBeNull();
  });

  it.each([
    ['id not kebab-case', { ...good, id: 'React_DOM' }, /id must be lowercase kebab-case/],
    ['empty members', { ...good, members: [] }, /members must be a non-empty array/],
    ['member not a tag id', { ...good, members: ['react'] }, /members\[0\] "react" is not a tag id/],
    ['unknown kind', { ...good, kind: 'widget' }, /kind must be one of/],
    ['eol is a number', { ...good, eol: 42 }, /eol must be an endoflife.date product id or null/],
    ['eol missing', { id: 'react', name: 'React', kind: 'library', members: ['npm:react'] }, /eol must be/],
    ['duplicate member', { ...good, members: ['npm:react', 'npm:react'] }, /listed twice/],
    ['not an object', ['npm:react'], /must be a JSON object/],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseFamily(input)).toThrow(message);
  });
});

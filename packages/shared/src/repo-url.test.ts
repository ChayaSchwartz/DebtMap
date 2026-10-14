import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from './repo-url';

describe('parseRepoUrl', () => {
  it.each([
    'https://github.com/sindresorhus/got',
    'http://github.com/sindresorhus/got',
    'github.com/sindresorhus/got',
    'www.github.com/sindresorhus/got',
    'https://github.com/sindresorhus/got/',
    'https://github.com/sindresorhus/got.git',
    'git@github.com:sindresorhus/got.git',
    'https://github.com/sindresorhus/got/tree/main/source',
    'https://github.com/sindresorhus/got?tab=readme-ov-file',
    '  https://github.com/sindresorhus/got  ',
  ])('normalises %s to the canonical form', (input) => {
    const parsed = parseRepoUrl(input);
    expect(parsed?.canonical).toBe('github.com/sindresorhus/got');
    expect(parsed?.owner).toBe('sindresorhus');
    expect(parsed?.name).toBe('got');
    expect(parsed?.cloneUrl).toBe('https://github.com/sindresorhus/got.git');
  });

  it.each([
    ['', 'empty input'],
    ['https://gitlab.com/owner/name', 'a host we do not support'],
    ['https://github.com/sindresorhus', 'a user page with no repository'],
    ['https://github.com/', 'the bare host'],
    ['not a url at all', 'free text'],
    ['https://github.com/features/actions', 'a reserved GitHub path'],
    ['https://github.com/owner/../etc', 'a traversal attempt'],
  ])('rejects %s (%s)', (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });

  it('keeps dots and hyphens that are legal in repository names', () => {
    expect(parseRepoUrl('https://github.com/vercel/next.js')?.name).toBe('next.js');
    expect(parseRepoUrl('https://github.com/my-org/my-repo')?.name).toBe('my-repo');
  });

  it('strips only a trailing .git, not a .git inside the name', () => {
    expect(parseRepoUrl('https://github.com/owner/dot.git.name')?.name).toBe('dot.git.name');
  });
});

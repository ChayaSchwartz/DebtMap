import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectGitMetrics, isBugFixMessage } from './git-metrics';

describe('isBugFixMessage', () => {
  it.each([
    'fix: null pointer in parser',
    'Fixed the retry loop',
    'fixes #421',
    'bugfix for timeout handling',
    'hotfix: restore login',
    'revert broken migration',
    'patch a regression in caching',
    'resolve #77',
    'the service crashed under load',
  ])('recognises %j as bug work', (message) => {
    expect(isBugFixMessage(message)).toBe(true);
  });

  it.each([
    'add prefix to generated ids',
    'refactor suffix handling',
    'document the issued token flow',
    'feat: add dark mode',
    'chore: bump dependencies',
    'update README',
  ])('does not mistake %j for bug work', (message) => {
    expect(isBugFixMessage(message)).toBe(false);
  });
});

describe('collectGitMetrics', () => {
  let dir: string;
  let git: SimpleGit;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'debtmap-git-'));
    git = simpleGit({ baseDir: dir });

    await git.init();
    await git.addConfig('user.email', 'test@debtmap.local');
    await git.addConfig('user.name', 'DebtMap Test');

    // hot.ts: touched five times, three of them bug fixes.
    // calm.ts: touched once, never a bug fix.
    await commit(git, dir, 'hot.ts', 'export const v = 1;', 'feat: add hot module');
    await commit(git, dir, 'calm.ts', 'export const c = 1;', 'feat: add calm module');
    await commit(git, dir, 'hot.ts', 'export const v = 2;', 'fix: correct hot value');
    await commit(git, dir, 'hot.ts', 'export const v = 3;', 'refactor hot module');
    await commit(git, dir, 'hot.ts', 'export const v = 4;', 'fix: hot regression');
    await commit(git, dir, 'hot.ts', 'export const v = 5;', 'bugfix in hot module');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('counts every commit that touched a file', async () => {
    const { perFile } = await collectGitMetrics({
      git,
      files: ['hot.ts', 'calm.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('hot.ts')?.churnCommits).toBe(5);
    expect(perFile.get('calm.ts')?.churnCommits).toBe(1);
  });

  it('counts only the bug-fix commits toward bug correlation', async () => {
    const { perFile } = await collectGitMetrics({
      git,
      files: ['hot.ts', 'calm.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('hot.ts')?.bugCommits).toBe(3);
    expect(perFile.get('calm.ts')?.bugCommits).toBe(0);
  });

  it('accumulates changed lines', async () => {
    const { perFile } = await collectGitMetrics({
      git,
      files: ['hot.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('hot.ts')?.churnLinesChanged).toBeGreaterThan(0);
  });

  it('reports zeroed metrics for a tracked file with no history', async () => {
    const { perFile } = await collectGitMetrics({
      git,
      files: ['hot.ts', 'never-committed.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('never-committed.ts')).toEqual({
      churnCommits: 0,
      churnLinesChanged: 0,
      bugCommits: 0,
      lastModified: null,
    });
  });

  it('ignores files outside the requested set', async () => {
    const { perFile } = await collectGitMetrics({
      git,
      files: ['calm.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.has('hot.ts')).toBe(false);
    expect(perFile.size).toBe(1);
  });

  it('retains recent commits per file, newest first', async () => {
    const { commitsByFile } = await collectGitMetrics({
      git,
      files: ['hot.ts'],
      churnWindowMonths: 24,
      commitsPerFile: 3,
    });

    const history = commitsByFile.get('hot.ts') ?? [];
    expect(history).toHaveLength(3);
    expect(history[0]?.message).toBe('bugfix in hot module');
    expect(history[0]?.isBugFix).toBe(true);
  });

  it('excludes history older than the churn window', async () => {
    // A file rewritten heavily years ago and untouched since is not a
    // present-day risk. Counting it as one would drown out live hotspots.
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    await commitAt(git, dir, 'ancient.ts', 'export const old = 1;', 'fix: ancient bug', threeYearsAgo);

    const { perFile } = await collectGitMetrics({
      git,
      files: ['ancient.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('ancient.ts')?.churnCommits).toBe(0);
    expect(perFile.get('ancient.ts')?.bugCommits).toBe(0);
  });

  it('includes history inside the churn window', async () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    await commitAt(git, dir, 'recent.ts', 'export const r = 1;', 'fix: recent bug', oneMonthAgo);

    const { perFile } = await collectGitMetrics({
      git,
      files: ['recent.ts'],
      churnWindowMonths: 24,
    });

    expect(perFile.get('recent.ts')?.churnCommits).toBe(1);
    expect(perFile.get('recent.ts')?.bugCommits).toBe(1);
  });
});

async function commit(
  git: SimpleGit,
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(path.join(dir, file), `${content}\n`, 'utf8');
  await git.add(file);
  await git.commit(message);
}

/**
 * Backdates the *committer* date, not just the author date: `git log --since`
 * filters on committer date, so setting `--date` alone would not move the
 * commit out of the window.
 */
async function commitAt(
  git: SimpleGit,
  dir: string,
  file: string,
  content: string,
  message: string,
  when: Date,
): Promise<void> {
  await writeFile(path.join(dir, file), `${content}\n`, 'utf8');
  await git.add(file);

  const iso = when.toISOString();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
  // simple-git refuses to spawn with an editor present in the supplied env.
  for (const key of ['EDITOR', 'VISUAL', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_PAGER', 'PAGER']) {
    delete env[key];
  }

  await simpleGit({ baseDir: dir }).env(env).commit(message);
}

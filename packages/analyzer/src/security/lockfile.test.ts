import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectLockedPackages, packageNameFromPath, parsePackageLock } from './lockfile';

describe('packageNameFromPath', () => {
  it('takes the package after the last node_modules segment', () => {
    expect(packageNameFromPath('node_modules/lodash')).toBe('lodash');
    expect(packageNameFromPath('node_modules/@scope/name')).toBe('@scope/name');
    expect(packageNameFromPath('node_modules/a/node_modules/b')).toBe('b');
    expect(packageNameFromPath('')).toBeUndefined();
  });
});

describe('parsePackageLock', () => {
  it('reads the flat map used by lockfile versions 2 and 3', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/@scope/pkg': { version: '2.1.0' },
        'node_modules/nested/node_modules/lodash': { version: '3.10.1' },
        'packages/web': { link: true, resolved: 'packages/web' },
      },
    });

    expect(parsePackageLock(lock)).toEqual([
      { name: 'lodash', version: '4.17.20' },
      { name: '@scope/pkg', version: '2.1.0' },
      { name: 'lodash', version: '3.10.1' },
    ]);
  });

  it('walks the nested tree used by version 1, which older repositories still carry', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        express: {
          version: '4.17.1',
          dependencies: { qs: { version: '6.7.0' } },
        },
      },
    });

    expect(parsePackageLock(lock)).toEqual([
      { name: 'express', version: '4.17.1' },
      { name: 'qs', version: '6.7.0' },
    ]);
  });

  it('drops resolutions OSV cannot be asked about', () => {
    const lock = JSON.stringify({
      packages: {
        'node_modules/from-git': { version: 'github:owner/repo#abc123' },
        'node_modules/linked': { version: 'file:../local' },
        'node_modules/real': { version: '1.2.3' },
      },
    });

    expect(parsePackageLock(lock)).toEqual([{ name: 'real', version: '1.2.3' }]);
  });

  it('keeps prerelease versions, which are installed like any other', () => {
    const lock = JSON.stringify({ packages: { 'node_modules/next': { version: '15.0.0-rc.1' } } });
    expect(parsePackageLock(lock)).toEqual([{ name: 'next', version: '15.0.0-rc.1' }]);
  });
});

describe('collectLockedPackages', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'debtmap-lock-'));

    await writeFile(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/lodash': { version: '4.17.20' } } }),
    );

    await mkdir(path.join(dir, 'apps', 'web'), { recursive: true });
    await writeFile(
      path.join(dir, 'apps', 'web', 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/lodash': { version: '4.17.20' },
          'node_modules/minimist': { version: '1.2.0' },
        },
      }),
    );

    // An installed copy: real in the working tree, and not this repository's
    // declared dependency set.
    await mkdir(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(
      path.join(dir, 'node_modules', 'dep', 'package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/should-not-appear': { version: '1.0.0' } } }),
    );

    await writeFile(path.join(dir, 'broken'), '');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('reads every lockfile in the repository except installed ones', async () => {
    const scan = await collectLockedPackages(dir);

    expect(scan.lockfiles).toEqual(['apps/web/package-lock.json', 'package-lock.json']);
    expect(scan.packages.map((entry) => entry.name).sort()).toEqual(['lodash', 'minimist']);
  });

  it('attributes a package to the first lockfile that resolved it', async () => {
    const scan = await collectLockedPackages(dir);
    const lodash = scan.packages.find((entry) => entry.name === 'lodash');

    expect(lodash?.lockfile).toBe('apps/web/package-lock.json');
  });

  it('reports nothing rather than failing when there is no lockfile', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'debtmap-nolock-'));
    try {
      expect(await collectLockedPackages(empty)).toEqual({ lockfiles: [], packages: [] });
    } finally {
      await rm(empty, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

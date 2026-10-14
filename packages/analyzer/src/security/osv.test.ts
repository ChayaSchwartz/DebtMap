import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compareVersions,
  createMemoryAdvisoryCache,
  pickFixedVersion,
  runOsv,
  toAdvisory,
  type OsvRecord,
} from './osv';

describe('toAdvisory', () => {
  const record: OsvRecord = {
    id: 'GHSA-p6mc-m468-83gg',
    summary: 'Prototype pollution in lodash',
    details: 'Longer prose that the UI has no room for.',
    severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' }],
    references: [
      { type: 'WEB', url: 'https://example.test/commit' },
      { type: 'ADVISORY', url: 'https://github.com/advisories/GHSA-p6mc-m468-83gg' },
    ],
    affected: [
      {
        package: { name: 'lodash', ecosystem: 'npm' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
      },
      {
        package: { name: 'lodash', ecosystem: 'PyPI' },
        ranges: [{ type: 'SEMVER', events: [{ fixed: '9.9.9' }] }],
      },
    ],
    database_specific: { severity: 'HIGH' },
  };

  it('keeps the publisher rating, the score, and the advisory link', () => {
    expect(toAdvisory(record)).toEqual({
      osvId: 'GHSA-p6mc-m468-83gg',
      severity: 'high',
      cvss: 7.5,
      summary: 'Prototype pollution in lodash',
      referenceUrl: 'https://github.com/advisories/GHSA-p6mc-m468-83gg',
      fixedVersions: { lodash: ['4.17.21'] },
    });
  });

  it('prefers the publisher rating over the CVSS band when they disagree', () => {
    // 7.5 alone would read as high; GitHub calls this one critical, and that is
    // the rating every npm user has already seen.
    const escalated = toAdvisory({ ...record, database_specific: { severity: 'CRITICAL' } });
    expect(escalated?.severity).toBe('critical');
  });

  it('falls back to the CVSS band when no rating is published', () => {
    const { database_specific: _ignored, ...bare } = record;
    expect(toAdvisory(bare)?.severity).toBe('high');
  });

  it('treats an unrated advisory as medium rather than hiding it', () => {
    expect(toAdvisory({ id: 'OSV-1', summary: 'Something' })?.severity).toBe('medium');
  });

  it('drops withdrawn advisories', () => {
    expect(toAdvisory({ ...record, withdrawn: '2026-01-01T00:00:00Z' })).toBeNull();
  });

  it('falls back to the first line of the details when there is no summary', () => {
    const { summary: _ignored, ...bare } = record;
    expect(toAdvisory(bare)?.summary).toBe('Longer prose that the UI has no room for.');
  });
});

describe('pickFixedVersion', () => {
  it('recommends the lowest fix ahead of the installed version', () => {
    expect(pickFixedVersion('4.17.20', ['4.17.21', '5.0.0', '3.0.0'])).toBe('4.17.21');
  });

  it('skips fixes that are already behind what is installed', () => {
    expect(pickFixedVersion('4.17.21', ['3.0.0', '4.17.21'])).toBeUndefined();
  });

  it('reports no fix when the advisory lists none', () => {
    expect(pickFixedVersion('1.0.0', [])).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('compares release components numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(0);
  });
});

describe('runOsv', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'debtmap-osv-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const writeLock = () =>
    writeFile(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/lodash': { version: '4.17.20' } } }),
    );

  const advisory: OsvRecord = {
    id: 'GHSA-p6mc-m468-83gg',
    summary: 'Prototype pollution in lodash',
    database_specific: { severity: 'HIGH' },
    affected: [
      {
        package: { name: 'lodash', ecosystem: 'npm' },
        ranges: [{ type: 'SEMVER', events: [{ fixed: '4.17.21' }] }],
      },
    ],
  };

  const stubFetch = (handler: (url: string) => unknown): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const body = handler(String(input));
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

  it('turns a vulnerable lockfile entry into a finding with a fix to apply', async () => {
    await writeLock();

    const result = await runOsv({
      dir,
      timeoutMs: 10_000,
      fetchImpl: stubFetch((url) =>
        url.endsWith('/querybatch')
          ? { results: [{ vulns: [{ id: 'GHSA-p6mc-m468-83gg' }] }] }
          : advisory,
      ),
    });

    expect(result.outcome).toMatchObject({ source: 'osv', status: 'ok', findingCount: 1 });
    expect(result.findings[0]).toMatchObject({
      source: 'osv',
      severity: 'high',
      ruleId: 'GHSA-p6mc-m468-83gg',
      packageName: 'lodash',
      vulnerableVersion: '4.17.20',
      fixedVersion: '4.17.21',
      filePath: 'package-lock.json',
    });
  });

  it('says it was skipped, not that the repository is clean, when there is no lockfile', async () => {
    const result = await runOsv({ dir, timeoutMs: 10_000, fetchImpl: stubFetch(() => undefined) });

    expect(result.outcome.status).toBe('skipped');
    expect(result.outcome.detail).toContain('no package-lock.json');
    expect(result.outcome.reason).toEqual({ code: 'noLockfile' });
  });

  it('reports a failed batch query as failed rather than as no findings', async () => {
    await writeLock();

    const result = await runOsv({
      dir,
      timeoutMs: 10_000,
      fetchImpl: stubFetch(() => undefined),
    });

    expect(result.outcome).toMatchObject({ source: 'osv', status: 'failed', findingCount: 0 });
    expect(result.outcome.detail).toContain('404');
    expect(result.outcome.reason).toEqual({ code: 'httpError', params: { status: 404 } });
  });

  it('keeps the findings it could resolve when one advisory lookup fails', async () => {
    await writeLock();

    const result = await runOsv({
      dir,
      timeoutMs: 10_000,
      fetchImpl: stubFetch((url) =>
        url.endsWith('/querybatch')
          ? { results: [{ vulns: [{ id: 'GHSA-p6mc-m468-83gg' }, { id: 'GHSA-missing' }] }] }
          : url.endsWith('GHSA-missing')
            ? undefined
            : advisory,
      ),
    });

    expect(result.findings).toHaveLength(1);
    expect(result.outcome.status).toBe('ok');
    expect(result.outcome.detail).toContain('1 advisory lookup(s) failed');
    expect(result.outcome.reason).toEqual({ code: 'partialLookups', params: { count: 1 } });
  });

  it('asks for each advisory once, however many runs share the cache', async () => {
    await writeLock();
    const cache = createMemoryAdvisoryCache();
    const requested: string[] = [];

    const fetchImpl = stubFetch((url) => {
      requested.push(url);
      return url.endsWith('/querybatch')
        ? { results: [{ vulns: [{ id: 'GHSA-p6mc-m468-83gg' }] }] }
        : advisory;
    });

    await runOsv({ dir, timeoutMs: 10_000, fetchImpl, cache });
    await runOsv({ dir, timeoutMs: 10_000, fetchImpl, cache });

    expect(requested.filter((url) => url.includes('/vulns/'))).toHaveLength(1);
  });
});

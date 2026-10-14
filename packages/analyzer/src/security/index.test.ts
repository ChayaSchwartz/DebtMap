import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanSecurity } from './index';

/**
 * Semgrep and Gitleaks are external binaries that the test host is not required
 * to have, so the orchestration is exercised through OSV, whose network calls
 * can be stubbed. What is under test here is the partitioning and the failure
 * behaviour, both of which are source-agnostic.
 */
describe('scanSecurity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'debtmap-scan-'));
    await writeFile(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/lodash': { version: '4.17.20' } } }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const fetchImpl = (async (input: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        String(input).endsWith('/querybatch')
          ? { results: [{ vulns: [{ id: 'GHSA-test' }] }] }
          : {
              id: 'GHSA-test',
              summary: 'Prototype pollution',
              database_specific: { severity: 'CRITICAL' },
            },
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  const params = {
    dir: '',
    analyzedFiles: [] as readonly string[],
    semgrepTimeoutMs: 5_000,
    gitleaksTimeoutMs: 5_000,
    osvTimeoutMs: 5_000,
    fetchImpl,
  };

  it('files a finding on a path outside the analysed set as repository-level', async () => {
    const result = await scanSecurity({
      ...params,
      dir,
      analyzedFiles: ['src/index.ts'],
      sources: ['osv'],
    });

    expect(result.byFile.size).toBe(0);
    expect(result.repositoryFindings).toHaveLength(1);
    // The path is the only record of where the finding came from once it is no
    // longer attached to a file row.
    expect(result.repositoryFindings[0]).toMatchObject({
      severity: 'critical',
      packageName: 'lodash',
      filePath: 'package-lock.json',
    });
  });

  it('attaches a finding to the file it belongs to when that file was analysed', async () => {
    const result = await scanSecurity({
      ...params,
      dir,
      analyzedFiles: ['package-lock.json'],
      sources: ['osv'],
    });

    expect(result.repositoryFindings).toEqual([]);
    expect(result.byFile.get('package-lock.json')).toHaveLength(1);
    // A file-level finding carries no path: the row it hangs off is its path.
    expect(result.byFile.get('package-lock.json')?.[0]).not.toHaveProperty('filePath');
  });

  it('reports one outcome per source it was asked to run', async () => {
    const result = await scanSecurity({ ...params, dir, sources: ['osv'] });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ source: 'osv', status: 'ok', findingCount: 1 });
    expect(result.totalFindings).toBe(1);
  });

  it('keeps going when a source cannot run on this host', async () => {
    // Semgrep may or may not be installed where the tests run, and that is the
    // point: whichever it is, the source reports its own outcome and OSV's
    // findings still come back.
    const result = await scanSecurity({
      ...params,
      dir,
      sources: ['semgrep', 'osv'],
      semgrepTimeoutMs: 5_000,
    });

    expect(result.outcomes.map((outcome) => outcome.source)).toEqual(['semgrep', 'osv']);
    expect(result.repositoryFindings).toHaveLength(1);
  });
});

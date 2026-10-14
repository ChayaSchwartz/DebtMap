import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Advisory } from '@debtmap/analyzer';
import type { PrismaService } from '../prisma/prisma.service';
import { AdvisoryCacheService } from './advisory-cache.service';

function makeService(overrides: {
  findMany?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
}) {
  const findMany = overrides.findMany ?? vi.fn().mockResolvedValue([]);
  const upsert = overrides.upsert ?? vi.fn().mockResolvedValue(undefined);
  const prisma = { vulnerabilityCache: { findMany, upsert } } as unknown as PrismaService;

  return { service: new AdvisoryCacheService(prisma), findMany, upsert };
}

const advisory: Advisory = {
  osvId: 'GHSA-test',
  severity: 'high',
  cvss: 7.5,
  summary: 'Prototype pollution',
  referenceUrl: 'https://example.test/advisory',
  fixedVersions: { lodash: ['4.17.21'] },
};

describe('AdvisoryCacheService', () => {
  it('does not query when there is nothing to look up', async () => {
    const { service, findMany } = makeService({});

    expect(await service.get([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('ignores entries older than the cache lifetime', async () => {
    const { service, findMany } = makeService({});
    await service.get(['GHSA-test']);

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where.osvId).toEqual({ in: ['GHSA-test'] });
    // A stale advisory is worse than a missing one: severities are revised and
    // fixes are published after disclosure.
    expect(where.fetchedAt.gte.getTime()).toBeLessThan(Date.now());
  });

  it('restores the shape the analyzer stored', async () => {
    const { service } = makeService({
      findMany: vi.fn().mockResolvedValue([
        {
          osvId: 'GHSA-test',
          severity: 'high',
          cvss: 7.5,
          summary: 'Prototype pollution',
          referenceUrl: 'https://example.test/advisory',
          fixedVersions: { lodash: ['4.17.21'] },
        },
      ]),
    });

    expect(await service.get(['GHSA-test'])).toEqual([advisory]);
  });

  it('omits columns that were null rather than reporting them as values', async () => {
    const { service } = makeService({
      findMany: vi.fn().mockResolvedValue([
        {
          osvId: 'OSV-1',
          severity: 'medium',
          cvss: null,
          summary: 'Unrated',
          referenceUrl: null,
          fixedVersions: {},
        },
      ]),
    });

    const [restored] = await service.get(['OSV-1']);
    expect(restored).not.toHaveProperty('cvss');
    expect(restored).not.toHaveProperty('referenceUrl');
  });

  it('treats an unreachable cache as a miss, not as a failure', async () => {
    const { service } = makeService({
      findMany: vi.fn().mockRejectedValue(new Error('connection terminated')),
    });

    // A cache that cannot be read costs requests, not results, so the scan has
    // to keep going.
    expect(await service.get(['GHSA-test'])).toEqual([]);
  });

  it('refreshes the fetch time so a re-read advisory does not expire immediately', async () => {
    const { service, upsert } = makeService({});
    await service.put([advisory]);

    const call = upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({ osvId: 'GHSA-test' });
    expect(call.update.fixedVersions).toEqual({ lodash: ['4.17.21'] });
    expect(call.update.fetchedAt).toBeInstanceOf(Date);
  });

  it('keeps writing the rest when one advisory cannot be stored', async () => {
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(new Error('unique violation'))
      .mockResolvedValue(undefined);
    const { service } = makeService({ upsert });

    await service.put([advisory, { ...advisory, osvId: 'GHSA-other' }]);

    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

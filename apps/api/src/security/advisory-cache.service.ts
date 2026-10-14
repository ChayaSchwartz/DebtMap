import { Injectable, Logger } from '@nestjs/common';
import type { Advisory, AdvisoryCache } from '@debtmap/analyzer';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Advisories are re-read rather than trusted forever. Severity ratings get
 * revised and fixes get published after disclosure, so a cache with no expiry
 * would keep recommending an upgrade that has since been superseded.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Postgres-backed implementation of the analyzer's advisory cache port.
 *
 * OSV's batch endpoint returns ids and nothing more, so every distinct
 * vulnerability costs a second request. Advisories are the same for every
 * repository that depends on the same package, which makes them worth caching
 * across runs: a second analysis of a typical Node project usually needs no
 * detail requests at all.
 */
@Injectable()
export class AdvisoryCacheService implements AdvisoryCache {
  private readonly logger = new Logger(AdvisoryCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(osvIds: readonly string[]): Promise<Advisory[]> {
    if (osvIds.length === 0) return [];

    try {
      const rows = await this.prisma.vulnerabilityCache.findMany({
        where: {
          osvId: { in: [...osvIds] },
          fetchedAt: { gte: new Date(Date.now() - TTL_MS) },
        },
      });

      return rows.map((row) => ({
        osvId: row.osvId,
        severity: row.severity as Advisory['severity'],
        ...(row.cvss !== null ? { cvss: row.cvss } : {}),
        summary: row.summary,
        ...(row.referenceUrl ? { referenceUrl: row.referenceUrl } : {}),
        fixedVersions: (row.fixedVersions ?? {}) as Advisory['fixedVersions'],
      }));
    } catch (error) {
      // A cache that cannot be read costs requests, not results.
      this.logger.warn(`advisory cache read failed: ${describe(error)}`);
      return [];
    }
  }

  async put(advisories: readonly Advisory[]): Promise<void> {
    for (const advisory of advisories) {
      const data = {
        severity: advisory.severity,
        cvss: advisory.cvss ?? null,
        summary: advisory.summary,
        referenceUrl: advisory.referenceUrl ?? null,
        fixedVersions: advisory.fixedVersions as unknown as Prisma.InputJsonValue,
        // Refreshed on write so an advisory re-fetched after expiry restarts
        // its TTL rather than expiring again on the next run.
        fetchedAt: new Date(),
      };

      try {
        await this.prisma.vulnerabilityCache.upsert({
          where: { osvId: advisory.osvId },
          create: { osvId: advisory.osvId, ...data },
          update: data,
        });
      } catch (error) {
        this.logger.warn(`advisory cache write failed for ${advisory.osvId}: ${describe(error)}`);
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

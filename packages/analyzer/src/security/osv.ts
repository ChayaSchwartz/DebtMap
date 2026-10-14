import type { ScanOutcome, SecurityFinding, Severity, ScanReason } from '@debtmap/shared';
import { cvssV3BaseScore, severityFromCvss } from './cvss';
import { collectLockedPackages, type LockedPackage } from './lockfile';
import { toTitle, type LocatedFinding, type ScannerContext, type ScannerResult } from './types';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

/** OSV accepts 1,000 queries per batch; half that leaves room for long names. */
const BATCH_SIZE = 500;

/** Advisory lookups are independent network calls; a handful at a time is polite. */
const DETAIL_CONCURRENCY = 8;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The advisory detail we keep. OSV records are large and mostly irrelevant to
 * us; these are the fields that reach the UI.
 */
export interface Advisory {
  osvId: string;
  severity: Severity;
  cvss?: number;
  summary: string;
  referenceUrl?: string;
  /**
   * Package name to every version that fixes this advisory. Kept per package
   * because one advisory can affect several, and kept as a list because a
   * vulnerability is usually patched on more than one release branch.
   */
  fixedVersions: Record<string, string[]>;
}

/**
 * Port for advisory storage, implemented by the API against Postgres and
 * defaulted to a per-run map here.
 *
 * OSV's batch endpoint returns ids and nothing else, so every distinct
 * vulnerability costs a second request. Advisories are immutable enough and
 * shared across repositories, so caching them turns dozens of round-trips per
 * run into almost none — and keeps the analyzer free of a database dependency
 * by leaving the storage to the caller.
 */
export interface AdvisoryCache {
  get(osvIds: readonly string[]): Promise<Advisory[]>;
  put(advisories: readonly Advisory[]): Promise<void>;
}

export interface OsvParams extends ScannerContext {
  cache?: AdvisoryCache;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

export async function runOsv(params: OsvParams): Promise<ScannerResult> {
  const started = Date.now();
  const scan = await collectLockedPackages(params.dir);

  if (scan.packages.length === 0) {
    return {
      findings: [],
      outcome: outcomeFor(
        'skipped',
        scan.lockfiles.length === 0
          ? 'no package-lock.json in this repository'
          : 'no resolved packages in the lockfile',
        0,
        Date.now() - started,
        { code: scan.lockfiles.length === 0 ? 'noLockfile' : 'noResolvedPackages' },
      ),
    };
  }

  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const cache = params.cache ?? createMemoryAdvisoryCache();
  const requestTimeoutMs = params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // One controller for the whole stage: whichever comes first — the caller
  // cancelling the run or the stage budget expiring — stops every request in
  // flight rather than only the next one.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), params.timeoutMs);
  deadline.unref?.();
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });

  const request = async (url: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]),
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      throw new OsvHttpError(response.status);
    }
    return (await response.json()) as unknown;
  };

  params.logger?.info('querying OSV', {
    packages: scan.packages.length,
    lockfiles: scan.lockfiles.length,
  });

  try {
    const idsByPackage = await queryBatches(scan.packages, request);
    const uniqueIds = [...new Set([...idsByPackage.values()].flat())];

    if (uniqueIds.length === 0) {
      return {
        findings: [],
        outcome: outcomeFor('ok', undefined, 0, Date.now() - started),
      };
    }

    const { advisories, failed } = await resolveAdvisories(uniqueIds, cache, request);
    const findings = buildFindings(scan.packages, idsByPackage, advisories);

    return {
      findings,
      outcome: outcomeFor(
        'ok',
        failed > 0 ? `${failed} advisory lookup(s) failed` : undefined,
        findings.length,
        Date.now() - started,
        failed > 0 ? { code: 'partialLookups', params: { count: failed } } : undefined,
      ),
    };
  } catch (error) {
    const seconds = Math.round(params.timeoutMs / 1000);
    const timedOut = controller.signal.aborted;
    const detail = timedOut
      ? `timed out after ${seconds}s`
      : error instanceof Error
        ? error.message
        : String(error);
    const reason: ScanReason = timedOut
      ? { code: 'timeout', params: { seconds } }
      : error instanceof OsvHttpError
        ? { code: 'httpError', params: { status: error.status } }
        : { code: 'unexpected' };
    return {
      findings: [],
      outcome: outcomeFor('failed', detail, 0, Date.now() - started, reason),
    };
  } finally {
    clearTimeout(deadline);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

type RequestFn = (url: string, init?: RequestInit) => Promise<unknown>;

/** Package key (`name@version`) to the OSV ids affecting it. */
async function queryBatches(
  packages: readonly LockedPackage[],
  request: RequestFn,
): Promise<Map<string, string[]>> {
  const idsByPackage = new Map<string, string[]>();

  for (let offset = 0; offset < packages.length; offset += BATCH_SIZE) {
    const chunk = packages.slice(offset, offset + BATCH_SIZE);
    const body = JSON.stringify({
      queries: chunk.map((entry) => ({
        version: entry.version,
        package: { name: entry.name, ecosystem: 'npm' },
      })),
    });

    const payload = (await request(OSV_BATCH_URL, { method: 'POST', body })) as OsvBatchResponse;
    const results = Array.isArray(payload?.results) ? payload.results : [];

    // Results are positional: OSV returns one entry per query, in order, and a
    // package with no advisories comes back as an empty object rather than
    // being omitted. Matching by index is therefore the contract, not a guess.
    chunk.forEach((entry, index) => {
      const ids = (results[index]?.vulns ?? [])
        .map((vuln) => vuln?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) idsByPackage.set(packageKey(entry), ids);
    });
  }

  return idsByPackage;
}

async function resolveAdvisories(
  ids: readonly string[],
  cache: AdvisoryCache,
  request: RequestFn,
): Promise<{ advisories: Map<string, Advisory>; failed: number }> {
  const advisories = new Map<string, Advisory>();

  for (const advisory of await cache.get(ids)) {
    advisories.set(advisory.osvId, advisory);
  }

  const missing = ids.filter((id) => !advisories.has(id));
  const fetched: Advisory[] = [];
  let failed = 0;

  for (let offset = 0; offset < missing.length; offset += DETAIL_CONCURRENCY) {
    const slice = missing.slice(offset, offset + DETAIL_CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map(async (id) => toAdvisory((await request(`${OSV_VULN_URL}/${id}`)) as OsvRecord)),
    );

    for (const result of settled) {
      // A single advisory that cannot be fetched costs us that one finding.
      // Failing the dependency scan over it would cost every other finding too.
      if (result.status === 'fulfilled' && result.value) {
        fetched.push(result.value);
        advisories.set(result.value.osvId, result.value);
      } else {
        failed += 1;
      }
    }
  }

  if (fetched.length > 0) await cache.put(fetched);

  return { advisories, failed };
}

function buildFindings(
  packages: readonly LockedPackage[],
  idsByPackage: ReadonlyMap<string, string[]>,
  advisories: ReadonlyMap<string, Advisory>,
): LocatedFinding[] {
  const findings: LocatedFinding[] = [];

  for (const entry of packages) {
    const ids = idsByPackage.get(packageKey(entry));
    if (!ids) continue;

    for (const id of ids) {
      const advisory = advisories.get(id);
      if (!advisory) continue;

      const fixed = pickFixedVersion(entry.version, advisory.fixedVersions[entry.name] ?? []);

      const finding: SecurityFinding = {
        source: 'osv',
        severity: advisory.severity,
        ruleId: advisory.osvId,
        title: toTitle(advisory.summary),
        packageName: entry.name,
        vulnerableVersion: entry.version,
        ...(fixed ? { fixedVersion: fixed } : {}),
        ...(advisory.referenceUrl ? { referenceUrl: advisory.referenceUrl } : {}),
      };

      findings.push({ ...finding, filePath: entry.lockfile ?? 'package-lock.json' });
    }
  }

  return findings;
}

/**
 * Exported for tests: this is where OSV's schema meets ours, and it must be
 * verifiable without a network.
 */
export function toAdvisory(record: OsvRecord): Advisory | null {
  const osvId = record?.id;
  if (!osvId) return null;
  // A withdrawn advisory has been retracted by its publisher. Reporting it
  // would send someone to upgrade away from a problem that does not exist.
  if (record.withdrawn) return null;

  const cvss = highestCvss(record.severity);
  const summary = record.summary ?? firstLine(record.details) ?? osvId;

  return {
    osvId,
    severity: toSeverity(record, cvss),
    ...(cvss !== null ? { cvss } : {}),
    summary,
    referenceUrl: preferredReference(record, osvId),
    fixedVersions: collectFixedVersions(record),
  };
}

/**
 * The publisher's own rating wins when it exists.
 *
 * GitHub curates the severity shown to every npm user for a GHSA, and
 * disagreeing with it would mean our "high" and their "critical" describe the
 * same advisory. CVSS is the fallback for records that carry only a vector.
 */
function toSeverity(record: OsvRecord, cvss: number | null): Severity {
  const declared = (record.database_specific?.severity ?? '').toUpperCase();
  if (declared === 'CRITICAL') return 'critical';
  if (declared === 'HIGH') return 'high';
  if (declared === 'MODERATE' || declared === 'MEDIUM') return 'medium';
  if (declared === 'LOW') return 'low';

  if (cvss !== null) return severityFromCvss(cvss);

  // An advisory with no rating at all is still an advisory. Treating it as
  // informational would hide it below the reporting threshold entirely.
  return 'medium';
}

function highestCvss(severities: OsvRecord['severity']): number | null {
  if (!Array.isArray(severities)) return null;

  const scores = severities
    .map((entry) => (typeof entry?.score === 'string' ? cvssV3BaseScore(entry.score) : null))
    .filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.max(...scores) : null;
}

function preferredReference(record: OsvRecord, osvId: string): string {
  const references = Array.isArray(record.references) ? record.references : [];
  const advisory = references.find((reference) => reference?.type === 'ADVISORY' && reference.url);
  return advisory?.url ?? references.find((reference) => reference?.url)?.url ?? `https://osv.dev/vulnerability/${osvId}`;
}

function collectFixedVersions(record: OsvRecord): Record<string, string[]> {
  const fixedVersions: Record<string, string[]> = {};

  for (const affected of record.affected ?? []) {
    const name = affected?.package?.name;
    if (!name || affected.package?.ecosystem !== 'npm') continue;

    for (const range of affected.ranges ?? []) {
      for (const event of range?.events ?? []) {
        if (!event?.fixed) continue;
        (fixedVersions[name] ??= []).push(event.fixed);
      }
    }
  }

  return fixedVersions;
}

/**
 * The lowest fix that is actually ahead of what is installed.
 *
 * An advisory patched on several release branches lists a fix for each, and
 * recommending 4.2.1 to a repository pinned at 2.0.0 asks for a major upgrade
 * where a patch release would do.
 */
export function pickFixedVersion(
  installed: string,
  candidates: readonly string[],
): string | undefined {
  return [...candidates]
    .sort(compareVersions)
    .find((candidate) => compareVersions(candidate, installed) > 0);
}

/** Numeric comparison of the release part only; prerelease tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .split('-')[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

/** Advisories live only as long as the run unless the caller supplies storage. */
export function createMemoryAdvisoryCache(): AdvisoryCache {
  const store = new Map<string, Advisory>();
  return {
    async get(osvIds) {
      return osvIds.map((id) => store.get(id)).filter((entry): entry is Advisory => !!entry);
    },
    async put(advisories) {
      for (const advisory of advisories) store.set(advisory.osvId, advisory);
    },
  };
}

function packageKey(entry: LockedPackage): string {
  return `${entry.name}@${entry.version}`;
}

function firstLine(value: string | undefined): string | undefined {
  const line = value?.split('\n').find((candidate) => candidate.trim().length > 0);
  return line?.trim();
}

/** Carries the status so the outcome can say "blocked" rather than "broken". */
class OsvHttpError extends Error {
  constructor(readonly status: number) {
    super(`OSV responded ${status}`);
  }
}

function outcomeFor(
  status: ScanOutcome['status'],
  detail: string | undefined,
  findingCount: number,
  durationMs: number,
  reason?: ScanReason,
): ScanOutcome {
  return {
    source: 'osv',
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    findingCount,
    durationMs,
  };
}

// --- OSV's schema, narrowed to the fields we read ---------------------------

interface OsvBatchResponse {
  results?: { vulns?: { id?: string }[] }[];
}

export interface OsvRecord {
  id?: string;
  summary?: string;
  details?: string;
  withdrawn?: string;
  severity?: { type?: string; score?: string }[];
  references?: { type?: string; url?: string }[];
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type?: string; events?: { introduced?: string; fixed?: string }[] }[];
  }[];
  database_specific?: { severity?: string };
}

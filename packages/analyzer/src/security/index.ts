import {
  SEVERITY_RANK,
  type ScanOutcome,
  type SecurityFinding,
  type SecuritySource,
} from '@debtmap/shared';
import type { AnalyzerLogger } from '../types';
import { runGitleaks } from './gitleaks';
import { runOsv, type AdvisoryCache } from './osv';
import { runSemgrep } from './semgrep';
import type { LocatedFinding, ScannerResult } from './types';

export { runSemgrep, parseSemgrepOutput, DEFAULT_SEMGREP_CONFIGS } from './semgrep';
export { runGitleaks, parseGitleaksReport, toGitleaksSeverity } from './gitleaks';
export {
  runOsv,
  toAdvisory,
  pickFixedVersion,
  compareVersions,
  createMemoryAdvisoryCache,
  type Advisory,
  type AdvisoryCache,
  type OsvRecord,
} from './osv';
export { collectLockedPackages, parsePackageLock, type LockedPackage } from './lockfile';
export { cvssV3BaseScore, severityFromCvss } from './cvss';
export { runTool, type ToolResult, type ToolStatus } from './process';
export type { LocatedFinding, ScannerResult } from './types';

/**
 * A file with fifty findings is a file with a problem, not fifty problems, and
 * the row that carries them has to be storable and readable. The score already
 * ignores volume past a small bonus, so truncating the list changes nothing but
 * the size of the payload.
 */
const MAX_FINDINGS_PER_FILE = 50;

/** Same reasoning at the repository level, where a monorepo can list thousands. */
const MAX_REPOSITORY_FINDINGS = 500;

export interface SecurityScanParams {
  /** The clone directory. */
  dir: string;
  /** Paths in the analysed set; anything else becomes a repository-level finding. */
  analyzedFiles: readonly string[];
  semgrepTimeoutMs: number;
  gitleaksTimeoutMs: number;
  osvTimeoutMs: number;
  semgrepConfigs?: readonly string[];
  /** Sources to run. Defaults to all three. */
  sources?: readonly SecuritySource[];
  advisoryCache?: AdvisoryCache;
  fetchImpl?: typeof fetch;
  logger?: AnalyzerLogger;
  signal?: AbortSignal;
  onProgress?: (source: SecuritySource, completed: number, total: number) => void;
}

export interface SecurityScanResult {
  /** Findings on files that are part of the analysed set, keyed by path. */
  byFile: Map<string, SecurityFinding[]>;
  /**
   * Findings that belong to the repository as a whole: vulnerable dependencies,
   * and secrets on paths outside the analysed set — including files that exist
   * only in history, which is the case full-depth cloning exists to catch.
   */
  repositoryFindings: SecurityFinding[];
  outcomes: ScanOutcome[];
  /** True count, before either cap above was applied. */
  totalFindings: number;
}

const ALL_SOURCES: readonly SecuritySource[] = ['semgrep', 'gitleaks', 'osv'];

/**
 * Runs the three security sources and sorts their findings into per-file and
 * repository-level buckets.
 *
 * Sequentially, on purpose. Semgrep and Gitleaks are both CPU- and IO-bound
 * over the same clone, and the deploy target is a small container that already
 * runs the queue at concurrency 1; overlapping them would trade a shorter wall
 * clock for a real chance of an OOM kill that loses the entire analysis.
 *
 * No scanner failure propagates. Each one reports its own outcome, and a run
 * where Semgrep is missing still returns Gitleaks and OSV results rather than
 * nothing.
 */
export async function scanSecurity(params: SecurityScanParams): Promise<SecurityScanResult> {
  const sources = params.sources ?? ALL_SOURCES;
  const analyzed = new Set(params.analyzedFiles);
  const located: LocatedFinding[] = [];
  const outcomes: ScanOutcome[] = [];

  let completed = 0;

  for (const source of sources) {
    if (params.signal?.aborted) break;
    params.onProgress?.(source, completed, sources.length);

    const result = await runSource(source, params);
    located.push(...result.findings);
    outcomes.push(result.outcome);

    if (result.outcome.status !== 'ok') {
      params.logger?.warn(`${source} did not run`, {
        status: result.outcome.status,
        detail: result.outcome.detail ?? '',
      });
    }

    completed += 1;
  }

  return partition(located, analyzed, outcomes);
}

async function runSource(
  source: SecuritySource,
  params: SecurityScanParams,
): Promise<ScannerResult> {
  const context = { dir: params.dir, logger: params.logger, signal: params.signal };

  try {
    switch (source) {
      case 'semgrep':
        return await runSemgrep({
          ...context,
          timeoutMs: params.semgrepTimeoutMs,
          ...(params.semgrepConfigs ? { configs: params.semgrepConfigs } : {}),
        });
      case 'gitleaks':
        return await runGitleaks({ ...context, timeoutMs: params.gitleaksTimeoutMs });
      case 'osv':
        return await runOsv({
          ...context,
          timeoutMs: params.osvTimeoutMs,
          ...(params.advisoryCache ? { cache: params.advisoryCache } : {}),
          ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
        });
    }
  } catch (error) {
    // The scanners are written not to throw. This is the net for the case where
    // one does anyway: an unexpected failure in a single source must not take
    // the other two, or the rest of the analysis, with it.
    return {
      findings: [],
      outcome: {
        source,
        status: 'failed',
        reason: { code: 'unexpected' },
        detail: error instanceof Error ? error.message : String(error),
        findingCount: 0,
        durationMs: 0,
      },
    };
  }
}

function partition(
  located: readonly LocatedFinding[],
  analyzed: ReadonlySet<string>,
  outcomes: ScanOutcome[],
): SecurityScanResult {
  const byFile = new Map<string, SecurityFinding[]>();
  const repositoryFindings: SecurityFinding[] = [];

  for (const finding of located) {
    const { filePath, ...rest } = finding;

    if (analyzed.has(filePath)) {
      const existing = byFile.get(filePath);
      if (existing) existing.push(rest);
      else byFile.set(filePath, [rest]);
    } else {
      // The path is kept here — it is the only record of where the finding
      // came from once it is no longer attached to a file row.
      repositoryFindings.push({ ...rest, filePath });
    }
  }

  for (const [file, findings] of byFile) {
    byFile.set(file, findings.sort(bySeverityThenLine).slice(0, MAX_FINDINGS_PER_FILE));
  }

  repositoryFindings.sort(bySeverityThenLine);

  return {
    byFile,
    repositoryFindings: repositoryFindings.slice(0, MAX_REPOSITORY_FINDINGS),
    outcomes,
    totalFindings: located.length,
  };
}

/** Worst first, then in file order, so a truncated list keeps what matters. */
function bySeverityThenLine(a: SecurityFinding, b: SecurityFinding): number {
  const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (bySeverity !== 0) return bySeverity;

  const byLine = (a.line ?? 0) - (b.line ?? 0);
  if (byLine !== 0) return byLine;

  return a.ruleId.localeCompare(b.ruleId);
}

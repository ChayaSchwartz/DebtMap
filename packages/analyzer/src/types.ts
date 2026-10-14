import type { RunErrorCode, ScanOutcome, SecurityFinding, SecuritySource } from '@debtmap/shared';
import type { AdvisoryCache } from './security';

export interface AnalyzerLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export type AnalyzerStage =
  | 'cloning'
  | 'discovering'
  | 'git-metrics'
  | 'ast-metrics'
  | 'security'
  | 'scoring';

export interface ProgressEvent {
  stage: AnalyzerStage;
  /** 0-100 across the whole analysis, not within the stage. */
  progress: number;
  detail?: string;
}

export interface AnalyzerOptions {
  /** Directory that clones are created in and removed from. */
  workspaceDir: string;
  maxFiles: number;
  cloneTimeoutMs: number;
  /**
   * Churn and bug-fix commits are counted within this window rather than over
   * all history. A file rewritten weekly five years ago and untouched since is
   * not a present-day risk, and counting it as one drowns out live hotspots.
   * The clone itself stays complete so secret scanning still sees everything.
   */
  churnWindowMonths: number;

  /**
   * Runs Semgrep, Gitleaks, and OSV. Off, the security dimension reports
   * "not run" for every source rather than a misleading zero — which is what
   * the CLI's `--no-security` is for while calibrating the other dimension.
   */
  security: boolean;
  /**
   * Which sources to run. A host without the Semgrep binary, or a deployment
   * with no outbound network for OSV, can drop one without losing the others.
   * Sources left out are reported as skipped, never as clean.
   */
  securitySources?: readonly SecuritySource[];
  semgrepTimeoutMs: number;
  gitleaksTimeoutMs: number;
  osvTimeoutMs: number;
  /** Overrides the default Semgrep rulesets; empty means "use the defaults". */
  semgrepConfigs?: readonly string[];
  /**
   * Advisory storage shared across runs. The API backs it with Postgres; left
   * unset, advisories are cached only for the duration of this analysis.
   */
  advisoryCache?: AdvisoryCache;
  onProgress?: (event: ProgressEvent) => void;
  logger?: AnalyzerLogger;
  signal?: AbortSignal;
}

export const DEFAULT_ANALYZER_OPTIONS = {
  maxFiles: 5000,
  cloneTimeoutMs: 300_000,
  churnWindowMonths: 24,
  security: true,
  // Semgrep is by far the slowest stage on a large repository; OSV is a
  // handful of HTTP calls and should never hold a run open for minutes.
  semgrepTimeoutMs: 600_000,
  gitleaksTimeoutMs: 300_000,
  osvTimeoutMs: 120_000,
} as const;

// --- Intermediate measurements ---------------------------------------------

export interface GitFileMetrics {
  churnCommits: number;
  churnLinesChanged: number;
  bugCommits: number;
  lastModified: Date | null;
}

export interface AstFileMetrics {
  loc: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;
  /** Set when the file could not be parsed; metrics are then zeroed. */
  parseError?: string;
}

export interface CommitRecord {
  sha: string;
  message: string;
  authorName: string;
  date: Date;
  isBugFix: boolean;
}

// --- Result ----------------------------------------------------------------

export interface AnalyzedFile {
  path: string;
  loc: number;

  churnCommits: number;
  churnLinesChanged: number;
  bugCommits: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;

  churnScore: number;
  bugScore: number;
  complexityScore: number;

  bugPronenessScore: number;
  securityScore: number;
  securityFindings: SecurityFinding[];
}

export interface AnalysisResult {
  commitSha: string;
  defaultBranch: string;
  filesAnalyzed: number;
  /** Files matched before the maxFiles cap was applied. */
  filesDiscovered: number;
  truncated: boolean;
  files: AnalyzedFile[];
  scanOutcomes: ScanOutcome[];
  /**
   * Findings that belong to no analysed file: vulnerable dependencies, and
   * secrets on paths outside the analysed set — including files that exist only
   * in history. They contribute to the repository security score, so dropping
   * them would leave that score unexplainable.
   */
  repositoryFindings: SecurityFinding[];
  /** Repository-level aggregates, computed from the file set. */
  securityScore: number;
  bugPronenessScore: number;
  durationMs: number;
}

/**
 * A failure whose cause is known well enough to tell the user in their own
 * language. Anything else that escapes the pipeline is reported as `unknown`.
 */
export class AnalyzerError extends Error {
  constructor(
    readonly code: RunErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AnalyzerError';
  }
}

import type { ScanReason } from './messages';

/**
 * The two risk dimensions DebtMap reports.
 *
 * They are deliberately never combined into a single number. A file with a
 * hardcoded credential and a file that is merely hard to change are different
 * problems with different owners and different fixes; averaging them produces
 * a score that means nothing and hides both.
 */
export const RISK_DIMENSIONS = ['security', 'bugProneness'] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

/** Severity ranking shared by every security source (Semgrep, Gitleaks, OSV). */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
});

/** Where a security finding came from. Surfaced in the UI so users can judge it. */
export type SecuritySource = 'semgrep' | 'gitleaks' | 'osv';

export interface SecurityFinding {
  source: SecuritySource;
  severity: Severity;
  /** Rule id, leak rule, or OSV vulnerability id (e.g. `GHSA-xxxx-xxxx-xxxx`). */
  ruleId: string;
  title: string;
  /** Absent for dependency findings, which are not tied to a source line. */
  line?: number;
  /**
   * Set only on repository-level findings, which are not attached to a file in
   * the analysed set: a lockfile, or a path that exists solely in history
   * because the secret was committed and later deleted. File-level findings
   * leave it empty — their path is the file they hang off.
   */
  filePath?: string;
  /** Commit that introduced a secret, when the finding comes from history. */
  commitSha?: string;
  /** Populated for OSV findings only. */
  packageName?: string;
  vulnerableVersion?: string;
  fixedVersion?: string;
  /** Link to the advisory or rule documentation, when the source provides one. */
  referenceUrl?: string;
}

/**
 * Per-source outcome. A scanner that fails must not fail the whole run — the
 * other dimensions are still worth reporting — so the UI needs to distinguish
 * "we looked and found nothing" from "we never got to look".
 */
export type ScanStatus = 'ok' | 'skipped' | 'failed';

export interface ScanOutcome {
  source: SecuritySource;
  status: ScanStatus;
  /** Why it was skipped or how it failed, as a code the UI translates. */
  reason?: ScanReason;
  /** The same in English, with technical specifics. For logs and debugging. */
  detail?: string;
  findingCount: number;
  durationMs: number;
}

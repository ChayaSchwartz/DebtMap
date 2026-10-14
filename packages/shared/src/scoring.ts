import { SEVERITY_RANK, type Severity } from './risk';

/**
 * Bug-proneness weights, per spec: 0.3 churn + 0.4 bugs + 0.3 complexity.
 *
 * Bug correlation carries the largest weight because it is the only direct
 * evidence: churn and complexity predict that a file *might* break, while a
 * history of bug-fix commits records that it already has.
 */
export const BUG_PRONENESS_WEIGHTS = Object.freeze({
  churn: 0.3,
  bugs: 0.4,
  complexity: 0.3,
});

/** Scores are percentile ranks within a single repository, on a 0-100 scale. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/**
 * Above this score a file is treated as high risk: shown in the danger band and
 * eligible for an AI explanation. Each dimension is thresholded independently —
 * a file can qualify on security alone without being bug-prone, and vice versa.
 */
export const HIGH_RISK_THRESHOLD = 70;

export interface BugPronenessInput {
  churnScore: number;
  bugScore: number;
  complexityScore: number;
}

export function computeBugProneness(input: BugPronenessInput): number {
  const raw =
    input.churnScore * BUG_PRONENESS_WEIGHTS.churn +
    input.bugScore * BUG_PRONENESS_WEIGHTS.bugs +
    input.complexityScore * BUG_PRONENESS_WEIGHTS.complexity;
  return clampScore(raw);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return SCORE_MIN;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value * 100) / 100));
}

/**
 * A file's security score is driven by its worst finding, not by how many it
 * has. Ten low-severity lint hits are not equivalent to one leaked credential,
 * so severity sets the floor and volume only nudges within that band.
 */
export function computeSecurityScore(severities: readonly Severity[]): number {
  if (severities.length === 0) return SCORE_MIN;

  const worst = severities.reduce<Severity>(
    (acc, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[acc] ? s : acc),
    'info',
  );

  const base = SEVERITY_BASE_SCORE[worst];
  const sameSeverityCount = severities.filter((s) => s === worst).length;
  const volumeBonus = Math.min(10, (sameSeverityCount - 1) * 2);

  return clampScore(base + volumeBonus);
}

/** Floor score contributed by the single worst finding in a file. */
const SEVERITY_BASE_SCORE: Readonly<Record<Severity, number>> = Object.freeze({
  critical: 90,
  high: 72,
  medium: 45,
  low: 20,
  info: 5,
});

// --- Absolute scoring ------------------------------------------------------
//
// Per-file scores are percentile ranks, which answer "which files are worst in
// this codebase". That is the right question for ranking, and the wrong one for
// a repository-level number: percentile ranks are uniform by construction, so
// any aggregate of them lands on the same value for every repository and never
// moves between runs. A trend line built on it would be flat forever.
//
// Repository health therefore uses an absolute scale, calibrated against fixed
// reference points rather than against the repository's own distribution.

/**
 * Raw measurement that maps to a score of 50. The curve saturates rather than
 * clipping, so a 2,000-complexity file still outranks a 400-complexity one
 * instead of both flattening to 100.
 */
export const ABSOLUTE_MIDPOINTS = Object.freeze({
  cyclomaticComplexity: 40,
  churnCommits: 12,
  bugCommits: 5,
});

export function saturatingScore(value: number, midpoint: number): number {
  if (value <= 0) return SCORE_MIN;
  return clampScore((SCORE_MAX * value) / (value + midpoint));
}

export interface AbsoluteMetricsInput {
  churnCommits: number;
  bugCommits: number;
  cyclomaticComplexity: number;
}

/**
 * Bug-proneness on an absolute scale, using the same 0.3/0.4/0.3 weighting as
 * the relative score so the two stay conceptually aligned.
 */
export function computeAbsoluteBugProneness(input: AbsoluteMetricsInput): number {
  const churn = saturatingScore(input.churnCommits, ABSOLUTE_MIDPOINTS.churnCommits);
  const bugs = saturatingScore(input.bugCommits, ABSOLUTE_MIDPOINTS.bugCommits);
  const complexity = saturatingScore(
    input.cyclomaticComplexity,
    ABSOLUTE_MIDPOINTS.cyclomaticComplexity,
  );

  return clampScore(
    churn * BUG_PRONENESS_WEIGHTS.churn +
      bugs * BUG_PRONENESS_WEIGHTS.bugs +
      complexity * BUG_PRONENESS_WEIGHTS.complexity,
  );
}

/** Presentation bands. Shared so the table, treemap, and detail view agree. */
export type RiskBand = 'critical' | 'high' | 'moderate' | 'low';

export function toRiskBand(score: number): RiskBand {
  if (score >= 85) return 'critical';
  if (score >= HIGH_RISK_THRESHOLD) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

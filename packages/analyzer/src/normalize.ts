import { SCORE_MAX, SCORE_MIN, clampScore } from '@debtmap/shared';

/**
 * Converts raw measurements into 0-100 percentile ranks within this repository.
 *
 * Min-max scaling was the obvious alternative and is worse here: a single
 * 12,000-line generated-but-not-excluded module would compress every genuine
 * hotspot into the bottom few points of the range. Percentile rank asks the
 * question the user is actually asking — "which files are the worst *in this
 * codebase*" — and is unmoved by how extreme the outlier is.
 *
 * Ties receive the same rank, so N identical files do not get spread apart by
 * an arbitrary ordering.
 */
export function percentileRanks(values: readonly number[]): number[] {
  const count = values.length;
  if (count === 0) return [];
  // With a single file there is no distribution to rank against; reporting it
  // as maximum risk would be an artefact of the sample size, not a finding.
  if (count === 1) return [SCORE_MIN];

  const sorted = [...values].sort((a, b) => a - b);

  // countBelow[v] = how many values are strictly less than v.
  const countBelow = new Map<number, number>();
  for (let i = 0; i < sorted.length; i += 1) {
    const value = sorted[i]!;
    if (!countBelow.has(value)) countBelow.set(value, i);
  }

  return values.map((value) => {
    const below = countBelow.get(value) ?? 0;
    return clampScore((below / (count - 1)) * SCORE_MAX);
  });
}

/**
 * Repository-level bug-proneness.
 *
 * Takes *absolute* per-file scores, never percentile ranks: the top decile of a
 * percentile distribution is ~95 in every repository ever measured, so an
 * aggregate built on ranks cannot distinguish two codebases or detect that one
 * improved between runs.
 *
 * Within that, the mean of the worst decile rather than of everything. A large
 * repository with a handful of genuinely dangerous files would otherwise
 * average out to a reassuring number — the exact failure this product exists to
 * prevent.
 */
export function aggregateBugProneness(absoluteScores: readonly number[]): number {
  if (absoluteScores.length === 0) return SCORE_MIN;

  const sorted = [...absoluteScores].sort((a, b) => b - a);
  const sampleSize = Math.max(1, Math.ceil(sorted.length * 0.1));
  const worst = sorted.slice(0, sampleSize);
  const total = worst.reduce((sum, score) => sum + score, 0);

  return clampScore(total / worst.length);
}

/**
 * Repository-level security, driven by the single worst file.
 *
 * Averaging is wrong here in a way it is not for bug-proneness. One leaked
 * production credential is a breach regardless of how many clean files sit
 * beside it, and any mean would let a large repository dilute it into
 * invisibility. Per-file security scores are already absolute, so the maximum
 * is directly comparable across runs.
 */
export function aggregateSecurity(securityScores: readonly number[]): number {
  if (securityScores.length === 0) return SCORE_MIN;
  return clampScore(Math.max(...securityScores));
}

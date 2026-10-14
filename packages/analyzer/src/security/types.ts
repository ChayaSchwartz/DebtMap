import type { ScanOutcome, SecurityFinding } from '@debtmap/shared';
import type { AnalyzerLogger } from '../types';

/**
 * A finding still carrying the path the scanner reported it against.
 *
 * Scanners report paths; the pipeline reports files. The two are not the same
 * set — a secret can live in a `.env` that was deleted three years ago, and a
 * vulnerable dependency belongs to a lockfile rather than to any source file —
 * so the split into per-file and repository-level findings happens once, in
 * `scanSecurity`, rather than inside each scanner.
 */
export type LocatedFinding = SecurityFinding & { filePath: string };

export interface ScannerResult {
  findings: LocatedFinding[];
  outcome: ScanOutcome;
}

export interface ScannerContext {
  /** The clone directory. */
  dir: string;
  timeoutMs: number;
  logger?: AnalyzerLogger;
  signal?: AbortSignal;
}

/** Repo-relative, forward slashes, no `./` prefix — the form `discover` returns. */
export function normalizeScannerPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Keeps a finding title to one line that fits a table cell. */
export function toTitle(value: string, limit = 160): string {
  const single = value.replace(/\s+/g, ' ').trim();
  if (!single) return 'Unnamed finding';
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}

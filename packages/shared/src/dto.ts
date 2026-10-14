import type { RunErrorCode } from './messages';
import type { RiskDimension, ScanOutcome, SecurityFinding } from './risk';

export const RUN_STATUSES = [
  'QUEUED',
  'CLONING',
  'ANALYZING',
  'SCANNING',
  'EXPLAINING',
  'COMPLETED',
  'FAILED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'FAILED'];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

// --- Requests --------------------------------------------------------------

export interface CreateAnalysisRequest {
  repoUrl: string;
}

// --- Responses -------------------------------------------------------------

export interface RepositorySummary {
  id: string;
  url: string;
  owner: string;
  name: string;
  defaultBranch: string;
}

/** Lightweight shape returned while polling; excludes the file list. */
export interface AnalysisRunStatusResponse {
  id: string;
  shareSlug: string;
  repository: RepositorySummary;
  status: RunStatus;
  /** Machine-readable stage key; the UI maps it to a translated string. */
  stage: string | null;
  progress: number;
  /** Why the run failed, as a code the UI translates. */
  errorCode: RunErrorCode | null;
  /** The same in English, with technical specifics. */
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AnalysisRunResponse extends AnalysisRunStatusResponse {
  commitSha: string | null;
  filesAnalyzed: number | null;
  securityScore: number | null;
  bugPronenessScore: number | null;
  scanOutcomes: ScanOutcome[];
  /**
   * Findings that belong to the repository rather than to any analysed file:
   * vulnerable dependencies, and secrets committed to paths that are not in
   * the analysed set — including files deleted long ago, which is the case
   * secret scanning exists to catch. They carry the repository security score
   * alongside the per-file ones, so they cannot be dropped from the response
   * without the score becoming unexplainable.
   */
  repositoryFindings: SecurityFinding[];
  files: FileMetricResponse[];
}

export interface FileMetricResponse {
  id: string;
  path: string;
  loc: number;

  // Raw measurements, shown alongside scores so a user can check our work.
  churnCommits: number;
  churnLinesChanged: number;
  bugCommits: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;

  // Percentile ranks within this repository, 0-100.
  churnScore: number;
  bugScore: number;
  complexityScore: number;

  bugPronenessScore: number;
  securityScore: number;
  securityFindings: SecurityFinding[];

  hasExplanation: boolean;
}

export interface FileDetailResponse extends FileMetricResponse {
  explanation: AiExplanationResponse | null;
  recentCommits: CommitSummary[];
}

export interface CommitSummary {
  sha: string;
  message: string;
  authorName: string;
  date: string;
}

/**
 * Both languages are generated in a single model call and stored together, so
 * switching the UI language never costs another request against the free-tier
 * per-minute budget, and a shared link reads correctly in either language.
 */
export interface AiExplanationResponse {
  summaryEn: string;
  summaryHe: string;
  recommendationEn: string;
  recommendationHe: string;
  primaryRiskFactor: RiskDimension;
  model: string;
  createdAt: string;
}

/** One point in a repository's history, for the trend view. */
export interface RunHistoryPoint {
  runId: string;
  shareSlug: string;
  finishedAt: string;
  commitSha: string | null;
  filesAnalyzed: number;
  securityScore: number;
  bugPronenessScore: number;
}

export const ANALYSIS_QUEUE = 'analysis';

export interface AnalysisJobData {
  runId: string;
  repositoryId: string;
  repoUrl: string;
  cloneUrl: string;
}

/**
 * One job at a time.
 *
 * This is not a simplification to revisit later: a clone of up to 1 GB plus a
 * Semgrep scan over thousands of files is the entire resource budget of a small
 * container. Two concurrent runs would contend for the same disk and memory and
 * make both slower than running them in sequence — or kill the process.
 */
export const ANALYSIS_CONCURRENCY = 1;

/**
 * How long the worker may go without renewing its job lock.
 *
 * The worker shares the event loop with the analysis, and parsing a large file
 * is synchronous. BullMQ's 30-second default is shorter than that can take, and
 * a lock that lapses mid-run makes BullMQ declare the job stalled and start it
 * again from the clone — after a ten-minute analysis had already succeeded.
 */
export const ANALYSIS_LOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * A stalled job is failed, never re-run. Analysis failures are deterministic
 * (see `attempts: 1` where jobs are added), so a silent restart would only
 * repeat the same stall and leave the user watching a progress bar go backwards.
 */
export const ANALYSIS_MAX_STALLED_COUNT = 0;

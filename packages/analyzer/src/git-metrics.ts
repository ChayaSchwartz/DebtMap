import type { SimpleGit } from 'simple-git';
import type { CommitRecord, GitFileMetrics } from './types';

/**
 * Word-boundary anchored so `prefix`, `suffix`, and `issued` do not register as
 * bug work. Conventional-commit `fix:` and `fix(scope):` are matched by the
 * first pattern via the boundary before the colon or parenthesis.
 */
const BUG_PATTERNS: readonly RegExp[] = [
  /\bfix(e[sd]|ing)?\b/i,
  /\bbug(s|fix|fixes)?\b/i,
  /\bhotfix\b/i,
  /\bregression\b/i,
  /\bcrash(e[sd]|ing)?\b/i,
  /\bbroken\b/i,
  /\bdefects?\b/i,
  /\bfaulty\b/i,
  /\brevert(e[sd])?\b/i,
  /\b(closes?|resolves?|fixes)\s+#\d+/i,
];

export function isBugFixMessage(message: string): boolean {
  return BUG_PATTERNS.some((pattern) => pattern.test(message));
}

// Explicit escapes rather than literal control bytes in the source: a raw
// 0x01 survives poorly through editors and copy/paste, and a silently
// stripped separator would make the parser match nothing while still
// looking correct. Git passes unrecognised characters through verbatim,
// so interpolating these is equivalent to using its %x01 / %x1f escapes.
const RECORD_SEP = '\x01';
const FIELD_SEP = '\x1f';

export interface GitMetricsResult {
  perFile: Map<string, GitFileMetrics>;
  /** Most recent commits first, for AI context and the file detail view. */
  commitsByFile: Map<string, CommitRecord[]>;
  commitsScanned: number;
}

export interface GitMetricsParams {
  git: SimpleGit;
  /** Paths (repo-relative, forward slashes) to collect metrics for. */
  files: readonly string[];
  churnWindowMonths: number;
  /** How many recent commits to retain per file for context. */
  commitsPerFile?: number;
}

/**
 * Walks the log exactly once and aggregates in memory.
 *
 * The alternative — one `git log` per file — is what makes naive churn tools
 * unusable on large repositories: 5,000 files means 5,000 process spawns and
 * 5,000 history walks. One pass costs a single walk regardless of file count.
 */
export async function collectGitMetrics(params: GitMetricsParams): Promise<GitMetricsResult> {
  const { git, files, churnWindowMonths } = params;
  const commitsPerFile = params.commitsPerFile ?? 5;

  const tracked = new Set(files);
  const perFile = new Map<string, GitFileMetrics>();
  const commitsByFile = new Map<string, CommitRecord[]>();

  for (const file of files) {
    perFile.set(file, {
      churnCommits: 0,
      churnLinesChanged: 0,
      bugCommits: 0,
      lastModified: null,
    });
  }

  const since = new Date();
  since.setMonth(since.getMonth() - churnWindowMonths);

  const raw = await git.raw([
    'log',
    '--no-merges',
    '--numstat',
    // Renames are reported as an add of the new path plus a delete of the old
    // one, instead of git's `{old => new}` notation. That notation needs a
    // parser of its own, and the payoff would be history continuity across
    // renames — which barely matters inside a two-year window. The new path is
    // the one present in HEAD, so churn still lands on the file we report.
    '--no-renames',
    `--since=${since.toISOString()}`,
    `--format=${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`,
  ]);

  let current: CommitRecord | null = null;
  let commitsScanned = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith(RECORD_SEP)) {
      current = parseCommitHeader(line.slice(RECORD_SEP.length));
      if (current) commitsScanned += 1;
      continue;
    }

    if (!current) continue;

    const stat = parseNumstatLine(line);
    if (!stat || !tracked.has(stat.path)) continue;

    const metrics = perFile.get(stat.path)!;
    metrics.churnCommits += 1;
    metrics.churnLinesChanged += stat.added + stat.deleted;
    if (current.isBugFix) metrics.bugCommits += 1;
    if (!metrics.lastModified || current.date > metrics.lastModified) {
      metrics.lastModified = current.date;
    }

    const history = commitsByFile.get(stat.path);
    if (!history) {
      commitsByFile.set(stat.path, [current]);
    } else if (history.length < commitsPerFile) {
      history.push(current);
    }
  }

  return { perFile, commitsByFile, commitsScanned };
}

function parseCommitHeader(value: string): CommitRecord | null {
  const [sha, authorName, iso, ...rest] = value.split(FIELD_SEP);
  if (!sha || !iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const message = rest.join(FIELD_SEP);
  return {
    sha,
    message,
    authorName: authorName ?? 'unknown',
    date,
    isBugFix: isBugFixMessage(message),
  };
}

interface NumstatLine {
  added: number;
  deleted: number;
  path: string;
}

/**
 * A numstat row is `added<TAB>deleted<TAB>path`. Binary files report `-` for
 * both counts; they are counted as touched but contribute no line churn.
 */
function parseNumstatLine(line: string): NumstatLine | null {
  if (!line.trim()) return null;

  const parts = line.split('\t');
  if (parts.length < 3) return null;

  const [addedRaw, deletedRaw, ...pathParts] = parts;
  const rawPath = pathParts.join('\t');
  if (!rawPath) return null;

  return {
    added: addedRaw === '-' ? 0 : Number.parseInt(addedRaw ?? '0', 10) || 0,
    deleted: deletedRaw === '-' ? 0 : Number.parseInt(deletedRaw ?? '0', 10) || 0,
    path: normalizeLogPath(rawPath),
  };
}

/**
 * Git quotes paths containing non-ASCII or special characters when
 * `core.quotepath` is on, wrapping them in double quotes with octal escapes.
 */
function normalizeLogPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;

  const inner = value.slice(1, -1);
  const bytes: number[] = [];

  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] !== '\\') {
      bytes.push(inner.charCodeAt(i));
      continue;
    }

    const next = inner[i + 1];
    if (next && next >= '0' && next <= '7') {
      bytes.push(Number.parseInt(inner.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(unescapeChar(next));
      i += 1;
    }
  }

  return Buffer.from(bytes).toString('utf8');
}

function unescapeChar(char: string | undefined): number {
  switch (char) {
    case 'n':
      return 0x0a;
    case 't':
      return 0x09;
    case 'r':
      return 0x0d;
    default:
      return (char ?? '\\').charCodeAt(0);
  }
}

import type { ScanOutcome, Severity, ScanReason } from '@debtmap/shared';
import { runTool, summarizeStderr } from './process';
import {
  normalizeScannerPath,
  toTitle,
  type LocatedFinding,
  type ScannerContext,
  type ScannerResult,
} from './types';

/**
 * Registry rulesets, not `--config auto`.
 *
 * `auto` picks rules by phoning home with a project fingerprint, which is both
 * a privacy cost we have no reason to pay and a source of results that change
 * under us between runs. A fixed list means a repository re-analysed next month
 * is measured against the same rules it was measured against today.
 */
export const DEFAULT_SEMGREP_CONFIGS: readonly string[] = [
  'p/security-audit',
  'p/javascript',
  'p/typescript',
];

/**
 * Mirrors `discover`'s exclusions. Semgrep honours `.gitignore` on its own, but
 * vendored and minified code is frequently committed, and a bundled copy of a
 * library produces findings that belong to somebody else's repository.
 */
const EXCLUDES: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'third_party',
  '.next',
  '.nuxt',
  '.angular',
  '*.min.js',
  '*.bundle.js',
];

/**
 * Per-file rule timeout, in seconds, and how many timeouts a file may collect
 * before it is abandoned. Without these, one pathological generated file can
 * consume the whole scan budget and leave the rest of the repository unscanned.
 */
const RULE_TIMEOUT_SECONDS = 30;
const TIMEOUT_THRESHOLD = 3;

/**
 * Semgrep skips files it cannot fit in this budget instead of dying, which is
 * the behaviour we want: losing one enormous file is survivable, losing the
 * worker to an OOM kill takes the whole analysis with it.
 */
const MAX_MEMORY_MB = 1024;

export interface SemgrepParams extends ScannerContext {
  configs?: readonly string[];
}

export async function runSemgrep(params: SemgrepParams): Promise<ScannerResult> {
  const configs = params.configs?.length ? params.configs : DEFAULT_SEMGREP_CONFIGS;

  const args = [
    'scan',
    '--json',
    '--quiet',
    '--metrics=off',
    '--disable-version-check',
    `--timeout=${RULE_TIMEOUT_SECONDS}`,
    `--timeout-threshold=${TIMEOUT_THRESHOLD}`,
    `--max-memory=${MAX_MEMORY_MB}`,
    ...configs.flatMap((config) => ['--config', config]),
    ...EXCLUDES.flatMap((pattern) => ['--exclude', pattern]),
    '.',
  ];

  params.logger?.info('running semgrep', { configs: configs.join(',') });

  const run = await runTool({
    command: 'semgrep',
    args,
    cwd: params.dir,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    env: {
      SEMGREP_SEND_METRICS: 'off',
      SEMGREP_ENABLE_VERSION_CHECK: '0',
    },
  });

  if (run.status !== 'ok') {
    return {
      findings: [],
      outcome: outcomeFor(
        run.status === 'missing' ? 'skipped' : 'failed',
        run.detail,
        0,
        run.durationMs,
        run.reason,
      ),
    };
  }

  let parsed: SemgrepFindings;
  try {
    parsed = parseSemgrepOutput(run.stdout);
  } catch (error) {
    // The exit code only becomes interesting once parsing has failed: semgrep
    // exits non-zero for "findings were present" as readily as for a real
    // error, so unparseable output is the honest signal that something broke.
    const detail = summarizeStderr(run.stderr) ?? describe(error);
    return {
      findings: [],
      outcome: outcomeFor(
        'failed',
        `exit ${run.exitCode ?? '?'}: ${detail}`,
        0,
        run.durationMs,
        { code: 'badOutput' },
      ),
    };
  }

  if (parsed.errors.length > 0) {
    params.logger?.warn('semgrep could not scan every file', { count: parsed.errors.length });
  }

  return {
    findings: parsed.findings,
    outcome: outcomeFor(
      'ok',
      // A partial scan is reported as partial rather than presented as
      // complete coverage that happened to find little.
      parsed.errors.length > 0 ? `${parsed.errors.length} file(s) could not be scanned` : undefined,
      parsed.findings.length,
      run.durationMs,
    ),
  };
}

export interface SemgrepFindings {
  findings: LocatedFinding[];
  /** Rule or parse errors semgrep reported for individual files. */
  errors: string[];
}

/**
 * Exported for tests. The mapping from semgrep's schema to ours is the part
 * that breaks when semgrep changes its output, and it must be verifiable
 * without a semgrep installation.
 */
export function parseSemgrepOutput(stdout: string): SemgrepFindings {
  const raw = JSON.parse(stdout) as SemgrepJson;
  const results = Array.isArray(raw.results) ? raw.results : [];

  const findings = results.flatMap((result): LocatedFinding[] => {
    const filePath = normalizeScannerPath(result.path ?? '');
    if (!filePath) return [];

    const extra = result.extra ?? {};
    const metadata = extra.metadata ?? {};
    const checkId = result.check_id ?? 'semgrep.unknown';
    const url = referenceUrl(metadata);
    const line = result.start?.line;

    return [
      {
        source: 'semgrep',
        severity: toSeverity(extra.severity, metadata),
        ruleId: checkId,
        title: toTitle(extra.message ?? lastSegment(checkId)),
        ...(typeof line === 'number' && line > 0 ? { line } : {}),
        ...(url ? { referenceUrl: url } : {}),
        filePath,
      },
    ];
  });

  const errors = (Array.isArray(raw.errors) ? raw.errors : [])
    .map((error) => error?.message ?? error?.type ?? '')
    .filter(Boolean);

  return { findings, errors };
}

/**
 * Semgrep's three levels are coarser than ours, so `critical` is reserved for
 * rules whose own metadata claims both high impact and high likelihood. Calling
 * every `ERROR` critical would put an unescaped regex next to a leaked
 * production key, which is exactly what this scale exists to prevent.
 */
export function toSeverity(severity: string | undefined, metadata: SemgrepMetadata = {}): Severity {
  const level = (severity ?? '').toUpperCase();
  const impact = (metadata.impact ?? '').toUpperCase();
  const likelihood = (metadata.likelihood ?? '').toUpperCase();
  const confidence = (metadata.confidence ?? '').toUpperCase();

  // Newer semgrep versions can emit our own vocabulary directly.
  if (level === 'CRITICAL') return 'critical';
  if (level === 'HIGH') return 'high';
  if (level === 'MEDIUM') return 'medium';
  if (level === 'LOW') return 'low';

  if (level === 'ERROR') {
    if (impact === 'HIGH' && likelihood === 'HIGH') return 'critical';
    // A rule that admits it is guessing is not a certainty. It belongs above
    // the noise floor and below a confirmed finding.
    return confidence === 'LOW' ? 'medium' : 'high';
  }

  if (level === 'WARNING') return confidence === 'LOW' ? 'low' : 'medium';
  if (level === 'INFO') return 'low';

  return 'info';
}

function referenceUrl(metadata: SemgrepMetadata): string | undefined {
  if (typeof metadata.shortlink === 'string' && metadata.shortlink.startsWith('http')) {
    return metadata.shortlink;
  }
  if (Array.isArray(metadata.references)) {
    const first = metadata.references.find(
      (value): value is string => typeof value === 'string' && value.startsWith('http'),
    );
    if (first) return first;
  }
  if (typeof metadata.source === 'string' && metadata.source.startsWith('http')) {
    return metadata.source;
  }
  return undefined;
}

/** `javascript.express.security.audit.xss` reads better as `xss` in a table. */
function lastSegment(checkId: string): string {
  return checkId.split('.').at(-1) ?? checkId;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeFor(
  status: ScanOutcome['status'],
  detail: string | undefined,
  findingCount: number,
  durationMs: number,
  reason?: ScanReason,
): ScanOutcome {
  return {
    source: 'semgrep',
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    findingCount,
    durationMs,
  };
}

// --- Semgrep's JSON, narrowed to the fields we read -------------------------

export interface SemgrepMetadata {
  impact?: string;
  likelihood?: string;
  confidence?: string;
  references?: unknown;
  shortlink?: string;
  source?: string;
}

interface SemgrepResultEntry {
  check_id?: string;
  path?: string;
  start?: { line?: number };
  extra?: {
    message?: string;
    severity?: string;
    metadata?: SemgrepMetadata;
  };
}

interface SemgrepJson {
  results?: SemgrepResultEntry[];
  errors?: { message?: string; type?: string }[];
}

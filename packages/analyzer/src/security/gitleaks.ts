import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
 * Rules that fire on shape and entropy alone rather than on a provider's
 * documented token format. They are worth reporting and are wrong often enough
 * that ranking them beside a confirmed AWS key would train users to ignore
 * both.
 */
const HEURISTIC_RULE_MARKERS: readonly string[] = ['generic', 'entropy', 'password', 'curl-auth'];

export async function runGitleaks(params: ScannerContext): Promise<ScannerResult> {
  // The report goes to a temporary directory rather than to stdout: gitleaks
  // writes progress and its banner to stdout on some versions, and `/dev/stdout`
  // as a report path does not exist on Windows.
  const reportDir = await mkdtemp(path.join(tmpdir(), 'debtmap-gitleaks-'));
  const reportPath = path.join(reportDir, 'report.json');

  params.logger?.info('running gitleaks over full history');

  try {
    const run = await runTool({
      command: 'gitleaks',
      args: [
        'detect',
        '--source',
        '.',
        '--report-format',
        'json',
        '--report-path',
        reportPath,
        // Never let a live credential out of the clone: it would otherwise be
        // written to our database, returned by a public share link, and sent
        // to a model for explanation.
        '--redact',
        '--no-banner',
        // Without this gitleaks exits 1 whenever it finds anything, which is
        // indistinguishable from a crash at the process level.
        '--exit-code',
        '0',
        '--log-level',
        'error',
      ],
      cwd: params.dir,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
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

    let report: string;
    try {
      report = await readFile(reportPath, 'utf8');
    } catch {
      // No report file after a clean exit means gitleaks never got as far as
      // scanning — a bad flag on an unexpected version, most likely.
      return {
        findings: [],
        outcome: outcomeFor(
          'failed',
          summarizeStderr(run.stderr) ?? `exit ${run.exitCode ?? '?'}: no report was written`,
          0,
          run.durationMs,
          { code: 'badOutput' },
        ),
      };
    }

    let findings: LocatedFinding[];
    try {
      findings = parseGitleaksReport(report);
    } catch (error) {
      return {
        findings: [],
        outcome: outcomeFor(
          'failed',
          error instanceof Error ? error.message : String(error),
          0,
          run.durationMs,
          { code: 'badOutput' },
        ),
      };
    }

    return {
      findings,
      outcome: outcomeFor('ok', undefined, findings.length, run.durationMs),
    };
  } finally {
    await rm(reportDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
      () => undefined,
    );
  }
}

/**
 * Exported for tests, and deliberately tolerant: gitleaks writes an empty file
 * rather than `[]` when a scan finds nothing.
 */
export function parseGitleaksReport(report: string): LocatedFinding[] {
  const trimmed = report.trim();
  if (!trimmed) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const findings: LocatedFinding[] = [];

  for (const entry of parsed as GitleaksEntry[]) {
    const filePath = normalizeScannerPath(entry?.File ?? '');
    if (!filePath) continue;

    const ruleId = entry.RuleID ?? 'gitleaks.unknown';
    const line = typeof entry.StartLine === 'number' && entry.StartLine > 0 ? entry.StartLine : 0;

    // One secret that survives twenty commits is reported twenty times, once
    // per commit that carries it. They are the same credential and the same
    // fix, so the earliest sighting is kept and the rest are dropped — leaving
    // them in would let a single leak dominate a repository's finding count.
    const key = `${filePath}|${ruleId}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      source: 'gitleaks',
      severity: toGitleaksSeverity(ruleId),
      ruleId,
      title: toTitle(entry.Description ?? `Secret matched by ${ruleId}`),
      ...(line > 0 ? { line } : {}),
      ...(entry.Commit ? { commitSha: entry.Commit } : {}),
      filePath,
    });
  }

  return findings;
}

/**
 * A committed credential is critical by default. Git history is public and
 * permanent: rewriting it does not un-leak the secret, so the only real fix is
 * rotation, and that is not a low-priority task.
 */
export function toGitleaksSeverity(ruleId: string): Severity {
  const rule = ruleId.toLowerCase();
  return HEURISTIC_RULE_MARKERS.some((marker) => rule.includes(marker)) ? 'high' : 'critical';
}

function outcomeFor(
  status: ScanOutcome['status'],
  detail: string | undefined,
  findingCount: number,
  durationMs: number,
  reason?: ScanReason,
): ScanOutcome {
  return {
    source: 'gitleaks',
    status,
    ...(reason ? { reason } : {}),
    ...(detail ? { detail } : {}),
    findingCount,
    durationMs,
  };
}

/** Gitleaks' report schema, narrowed to the fields we read. */
interface GitleaksEntry {
  File?: string;
  RuleID?: string;
  Description?: string;
  StartLine?: number;
  Commit?: string;
}

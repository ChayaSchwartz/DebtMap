/**
 * Local harness for running the engine against a real repository without
 * standing up Postgres, Redis, or Nest.
 *
 * This is the primary tool for calibrating thresholds and, later, the AI
 * prompt: iterating through the UI would put a queue and a database between
 * a change and its effect on the output.
 *
 *   npm run analyze -- https://github.com/owner/name
 *   npm run analyze -- owner/name --max-files 500 --top 30
 */
import { toRiskBand, type SecurityFinding } from '@debtmap/shared';
import { analyzeRepository } from './analyze';
import type { AnalyzerLogger } from './types';

interface CliArgs {
  repoUrl: string;
  maxFiles: number;
  top: number;
  churnWindowMonths: number;
  security: boolean;
  verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(arg);
    }
  }

  const repoUrl = positional[0];
  if (!repoUrl) return null;

  return {
    repoUrl,
    maxFiles: Number.parseInt(flags.get('max-files') ?? '5000', 10),
    top: Number.parseInt(flags.get('top') ?? '25', 10),
    churnWindowMonths: Number.parseInt(flags.get('churn-months') ?? '24', 10),
    // Semgrep over a large repository dominates the wall clock, and the
    // bug-proneness thresholds this harness exists to calibrate do not depend
    // on it. `--no-security` keeps that iteration loop short.
    security: flags.get('no-security') !== 'true',
    verbose: flags.get('verbose') === 'true',
  };
}

const consoleLogger: AnalyzerLogger = {
  debug: (message, meta) => console.error(`  · ${message}`, meta ?? ''),
  info: (message, meta) => console.error(`  · ${message}`, meta ?? ''),
  warn: (message, meta) => console.error(`  ! ${message}`, meta ?? ''),
  error: (message, meta) => console.error(`  ✗ ${message}`, meta ?? ''),
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args) {
    console.error(
      'Usage: npm run analyze -- <repo-url> [--max-files N] [--top N] [--churn-months N] [--no-security]',
    );
    process.exitCode = 1;
    return;
  }

  const { result } = await analyzeRepository({
    repoUrl: args.repoUrl,
    workspaceDir: process.env.WORKSPACE_DIR ?? '.debtmap-workspace',
    maxFiles: args.maxFiles,
    churnWindowMonths: args.churnWindowMonths,
    security: args.security,
    logger: args.verbose ? consoleLogger : undefined,
    onProgress: ({ stage, progress, detail }) =>
      console.error(`[${String(progress).padStart(3)}%] ${stage}${detail ? ` — ${detail}` : ''}`),
  });

  const ranked = [...result.files]
    .sort((a, b) => b.bugPronenessScore - a.bugPronenessScore)
    .slice(0, args.top);

  console.log('');
  console.log(`Repository : ${args.repoUrl}`);
  console.log(`Commit     : ${result.commitSha.slice(0, 10)} on ${result.defaultBranch}`);
  console.log(
    `Files      : ${result.filesAnalyzed} analysed` +
      (result.truncated ? ` of ${result.filesDiscovered} found (capped)` : ''),
  );
  console.log(`Duration   : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Bug-prone  : ${result.bugPronenessScore.toFixed(1)} (worst decile mean)`);
  console.log(`Security   : ${result.securityScore.toFixed(1)} (worst file or repository finding)`);
  console.log('');

  const header = pad('FILE', 58) + pad('SCORE', 8) + pad('BAND', 11) + pad('CHURN', 8) + pad('BUGS', 7) + 'CPLX';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const file of ranked) {
    console.log(
      pad(truncateLeft(file.path, 56), 58) +
        pad(file.bugPronenessScore.toFixed(1), 8) +
        pad(toRiskBand(file.bugPronenessScore), 11) +
        pad(String(file.churnCommits), 8) +
        pad(String(file.bugCommits), 7) +
        String(file.cyclomaticComplexity),
    );
  }

  console.log('');
  console.log('SECURITY');
  console.log('-'.repeat(header.length));

  for (const outcome of result.scanOutcomes) {
    const found = outcome.status === 'ok' ? `${outcome.findingCount} finding(s)` : outcome.status;
    console.log(
      pad(outcome.source, 12) +
        pad(found, 18) +
        pad(`${(outcome.durationMs / 1000).toFixed(1)}s`, 9) +
        (outcome.detail ?? ''),
    );
  }

  const exposed = [...result.files]
    .filter((file) => file.securityFindings.length > 0)
    .sort((a, b) => b.securityScore - a.securityScore)
    .slice(0, args.top);

  if (exposed.length > 0) {
    console.log('');
    for (const file of exposed) {
      console.log(
        pad(truncateLeft(file.path, 56), 58) +
          pad(file.securityScore.toFixed(1), 8) +
          describeFinding(file.securityFindings[0]!),
      );
    }
  }

  if (result.repositoryFindings.length > 0) {
    console.log('');
    console.log(`Repository-level findings (${result.repositoryFindings.length}):`);
    for (const finding of result.repositoryFindings.slice(0, args.top)) {
      console.log(
        `  ${pad(finding.severity, 10)}${pad(finding.filePath ?? '-', 34)}${describeFinding(finding)}`,
      );
    }
  }
}

/** One line per finding: what it is, and what to do about it when we know. */
function describeFinding(finding: SecurityFinding): string {
  if (finding.packageName) {
    const fix = finding.fixedVersion ? ` -> ${finding.fixedVersion}` : ' (no fix published)';
    return `${finding.ruleId} ${finding.packageName}@${finding.vulnerableVersion}${fix}`;
  }
  return `${finding.severity}: ${finding.title}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

/** Keeps the filename visible; the leading directories are the expendable part. */
function truncateLeft(value: string, width: number): string {
  return value.length <= width ? value : `…${value.slice(value.length - width + 1)}`;
}

main().catch((error: unknown) => {
  console.error(`\nAnalysis failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

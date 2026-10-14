import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  computeAbsoluteBugProneness,
  computeBugProneness,
  computeSecurityScore,
  parseRepoUrl,
  type SecurityFinding,
  type SecuritySource,
} from '@debtmap/shared';
import { cleanupClone, cloneRepository } from './clone';
import { createParseProject, measureFile } from './complexity';
import { discoverFiles } from './discover';
import { collectGitMetrics } from './git-metrics';
import { aggregateBugProneness, aggregateSecurity, percentileRanks } from './normalize';
import { scanSecurity, type SecurityScanResult } from './security';
import {
  DEFAULT_ANALYZER_OPTIONS,
  type AnalysisResult,
  type AnalyzedFile,
  type AnalyzerOptions,
  type AstFileMetrics,
  type CommitRecord,
  type GitFileMetrics,
  type ProgressEvent,
  AnalyzerError,
} from './types';

export interface AnalyzeParams extends Partial<AnalyzerOptions> {
  repoUrl: string;
  workspaceDir: string;
}

export interface AnalyzeOutcome {
  result: AnalysisResult;
  /** Recent commits per file, for AI context. Not persisted as-is. */
  commitsByFile: Map<string, CommitRecord[]>;
}

/**
 * Runs the full pipeline against a public GitHub repository and always removes
 * the clone before returning, including on failure.
 */
export async function analyzeRepository(params: AnalyzeParams): Promise<AnalyzeOutcome> {
  const started = Date.now();
  const options = resolveOptions(params);
  const parsed = parseRepoUrl(params.repoUrl);

  if (!parsed) {
    throw new Error(`Not a recognisable public GitHub repository URL: ${params.repoUrl}`);
  }

  const report = (stage: Parameters<NonNullable<AnalyzerOptions['onProgress']>>[0]) =>
    options.onProgress?.(stage);

  report({ stage: 'cloning', progress: 5 });

  const clone = await cloneRepository({
    cloneUrl: parsed.cloneUrl,
    workspaceDir: options.workspaceDir,
    timeoutMs: options.cloneTimeoutMs,
    logger: options.logger,
  }).catch((error: unknown) => {
    throw new AnalyzerError(
      'cloneFailed',
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  });

  try {
    throwIfAborted(options.signal);
    report({ stage: 'discovering', progress: 20 });

    const discovery = await discoverFiles({ dir: clone.dir, maxFiles: options.maxFiles });

    if (discovery.files.length === 0) {
      throw new AnalyzerError(
        'noSourceFiles',
        'No TypeScript or JavaScript files found in this repository.',
      );
    }

    if (discovery.oversized.length > 0) {
      options.logger?.info('skipped oversized files as generated', {
        count: discovery.oversized.length,
        examples: discovery.oversized.slice(0, 5),
      });
    }

    if (discovery.truncated) {
      options.logger?.warn('file cap reached; analysing the largest files only', {
        discovered: discovery.discovered,
        analysed: discovery.files.length,
      });
    }

    throwIfAborted(options.signal);
    report({ stage: 'git-metrics', progress: 35, detail: `${discovery.files.length} files` });

    const gitMetrics = await collectGitMetrics({
      git: clone.git,
      files: discovery.files,
      churnWindowMonths: options.churnWindowMonths,
    });

    throwIfAborted(options.signal);
    report({ stage: 'ast-metrics', progress: 55 });

    const astMetrics = await measureAllFiles(clone.dir, discovery.files, options);

    throwIfAborted(options.signal);
    report({ stage: 'security', progress: 85 });

    const security = await runSecurityStage(clone.dir, discovery.files, options, report);

    throwIfAborted(options.signal);
    report({ stage: 'scoring', progress: 96 });

    const files = scoreFiles({
      paths: discovery.files,
      gitMetrics: gitMetrics.perFile,
      astMetrics,
      securityFindings: security.byFile,
    });

    return {
      result: {
        commitSha: clone.commitSha,
        defaultBranch: clone.defaultBranch,
        filesAnalyzed: files.length,
        filesDiscovered: discovery.discovered,
        truncated: discovery.truncated,
        files,
        scanOutcomes: security.outcomes,
        repositoryFindings: security.repositoryFindings,
        // Repository-level findings are scored as one more unit alongside the
        // files. A leaked credential in a deleted `.env`, or a critical
        // advisory in the lockfile, is a fact about this repository, and a
        // score computed only from surviving source files would call it clean.
        securityScore: aggregateSecurity([
          ...files.map((file) => file.securityScore),
          computeSecurityScore(security.repositoryFindings.map((finding) => finding.severity)),
        ]),
        // Deliberately the absolute score, not the percentile-based one shown
        // per file — see aggregateBugProneness for why ranks cannot aggregate.
        bugPronenessScore: aggregateBugProneness(
          files.map((file) =>
            computeAbsoluteBugProneness({
              churnCommits: file.churnCommits,
              bugCommits: file.bugCommits,
              cyclomaticComplexity: file.cyclomaticComplexity,
            }),
          ),
        ),
        durationMs: Date.now() - started,
      },
      commitsByFile: gitMetrics.commitsByFile,
    };
  } finally {
    await cleanupClone(clone.dir, options.logger);
  }
}

function resolveOptions(params: AnalyzeParams): AnalyzerOptions {
  return {
    workspaceDir: params.workspaceDir,
    maxFiles: params.maxFiles ?? DEFAULT_ANALYZER_OPTIONS.maxFiles,
    cloneTimeoutMs: params.cloneTimeoutMs ?? DEFAULT_ANALYZER_OPTIONS.cloneTimeoutMs,
    churnWindowMonths: params.churnWindowMonths ?? DEFAULT_ANALYZER_OPTIONS.churnWindowMonths,
    security: params.security ?? DEFAULT_ANALYZER_OPTIONS.security,
    semgrepTimeoutMs: params.semgrepTimeoutMs ?? DEFAULT_ANALYZER_OPTIONS.semgrepTimeoutMs,
    gitleaksTimeoutMs: params.gitleaksTimeoutMs ?? DEFAULT_ANALYZER_OPTIONS.gitleaksTimeoutMs,
    osvTimeoutMs: params.osvTimeoutMs ?? DEFAULT_ANALYZER_OPTIONS.osvTimeoutMs,
    ...(params.securitySources ? { securitySources: params.securitySources } : {}),
    ...(params.semgrepConfigs ? { semgrepConfigs: params.semgrepConfigs } : {}),
    ...(params.advisoryCache ? { advisoryCache: params.advisoryCache } : {}),
    onProgress: params.onProgress,
    logger: params.logger,
    signal: params.signal,
  };
}

/**
 * Runs the enabled security sources and reports the rest as skipped.
 *
 * A source that was never asked to run is not a source that found nothing, and
 * the difference has to survive all the way to the UI — otherwise a deployment
 * without the Semgrep binary quietly reports every repository as clean.
 */
async function runSecurityStage(
  dir: string,
  files: readonly string[],
  options: AnalyzerOptions,
  report: (event: ProgressEvent) => void,
): Promise<SecurityScanResult> {
  const enabled = options.security ? (options.securitySources ?? SECURITY_SOURCES) : [];

  const scan =
    enabled.length > 0
      ? await scanSecurity({
          dir,
          analyzedFiles: files,
          sources: enabled,
          semgrepTimeoutMs: options.semgrepTimeoutMs,
          gitleaksTimeoutMs: options.gitleaksTimeoutMs,
          osvTimeoutMs: options.osvTimeoutMs,
          ...(options.semgrepConfigs ? { semgrepConfigs: options.semgrepConfigs } : {}),
          ...(options.advisoryCache ? { advisoryCache: options.advisoryCache } : {}),
          ...(options.logger ? { logger: options.logger } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (source, completed, total) =>
            report({
              stage: 'security',
              progress: 85 + Math.round((completed / total) * 10),
              detail: source,
            }),
        })
      : {
          byFile: new Map<string, SecurityFinding[]>(),
          repositoryFindings: [],
          outcomes: [],
          totalFindings: 0,
        };

  for (const source of SECURITY_SOURCES) {
    if (enabled.includes(source)) continue;
    scan.outcomes.push({
      source,
      status: 'skipped',
      reason: { code: 'notEnabled' },
      detail: 'not enabled for this run',
      findingCount: 0,
      durationMs: 0,
    });
  }

  // Stable order regardless of which sources ran, so the UI's scanner list does
  // not reshuffle between analyses.
  scan.outcomes.sort(
    (a, b) => SECURITY_SOURCES.indexOf(a.source) - SECURITY_SOURCES.indexOf(b.source),
  );

  options.logger?.info('security scan complete', {
    findings: scan.totalFindings,
    outcomes: scan.outcomes.map((outcome) => `${outcome.source}:${outcome.status}`).join(' '),
  });

  return scan;
}

const SECURITY_SOURCES: readonly SecuritySource[] = ['semgrep', 'gitleaks', 'osv'];

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AnalyzerError('cancelled', 'Analysis was cancelled.');
}

async function measureAllFiles(
  dir: string,
  files: readonly string[],
  options: AnalyzerOptions,
): Promise<Map<string, AstFileMetrics>> {
  const project = createParseProject();
  const results = new Map<string, AstFileMetrics>();

  for (const [index, file] of files.entries()) {
    if (index % 250 === 0) {
      throwIfAborted(options.signal);
      options.onProgress?.({
        stage: 'ast-metrics',
        progress: 55 + Math.round((index / files.length) * 30),
        detail: `${index}/${files.length}`,
      });
    }

    try {
      const content = await readFile(path.join(dir, file), 'utf8');
      results.set(file, measureFile(project, `/${file}`, content));
    } catch (error) {
      options.logger?.debug('skipping unreadable file', { file });
      results.set(file, {
        loc: 0,
        cyclomaticComplexity: 0,
        maxNestingDepth: 0,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

interface ScoreParams {
  paths: readonly string[];
  gitMetrics: Map<string, GitFileMetrics>;
  astMetrics: Map<string, AstFileMetrics>;
  securityFindings: Map<string, SecurityFinding[]>;
}

function scoreFiles(params: ScoreParams): AnalyzedFile[] {
  const { paths, gitMetrics, astMetrics, securityFindings } = params;

  const churnRaw = paths.map((file) => gitMetrics.get(file)?.churnCommits ?? 0);
  const bugRaw = paths.map((file) => gitMetrics.get(file)?.bugCommits ?? 0);
  const complexityRaw = paths.map((file) => astMetrics.get(file)?.cyclomaticComplexity ?? 0);

  const churnScores = percentileRanks(churnRaw);
  const bugScores = percentileRanks(bugRaw);
  const complexityScores = percentileRanks(complexityRaw);

  return paths.map((file, index) => {
    const git = gitMetrics.get(file);
    const ast = astMetrics.get(file);
    const findings = securityFindings.get(file) ?? [];

    const churnScore = churnScores[index]!;
    const bugScore = bugScores[index]!;
    const complexityScore = complexityScores[index]!;

    return {
      path: file,
      loc: ast?.loc ?? 0,
      churnCommits: git?.churnCommits ?? 0,
      churnLinesChanged: git?.churnLinesChanged ?? 0,
      bugCommits: git?.bugCommits ?? 0,
      cyclomaticComplexity: ast?.cyclomaticComplexity ?? 0,
      maxNestingDepth: ast?.maxNestingDepth ?? 0,
      churnScore,
      bugScore,
      complexityScore,
      bugPronenessScore: computeBugProneness({ churnScore, bugScore, complexityScore }),
      securityScore: computeSecurityScore(findings.map((finding) => finding.severity)),
      securityFindings: findings,
    };
  });
}

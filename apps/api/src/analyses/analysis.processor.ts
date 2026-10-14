import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalyzerError,
  analyzeRepository,
  sweepWorkspace,
  type AnalyzerLogger,
  type ProgressEvent,
} from '@debtmap/analyzer';
import type { RunStatus } from '@debtmap/shared';
import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import {
  parseSecuritySources,
  parseSemgrepConfigs,
} from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AdvisoryCacheService } from '../security/advisory-cache.service';
import {
  ANALYSIS_CONCURRENCY,
  ANALYSIS_LOCK_DURATION_MS,
  ANALYSIS_MAX_STALLED_COUNT,
  ANALYSIS_QUEUE,
  type AnalysisJobData,
} from './analysis.queue';

/**
 * Runs in the same process as the API rather than as a separate service.
 *
 * The deployment target's free tier allows two services in total, and spending
 * one of them on a worker that is idle most of the time is a poor trade at this
 * scale. Concurrency is 1, so the worker cannot starve the HTTP handlers of
 * event-loop time for longer than one analysis stage at a time.
 */
@Processor(ANALYSIS_QUEUE, {
  concurrency: ANALYSIS_CONCURRENCY,
  lockDuration: ANALYSIS_LOCK_DURATION_MS,
  maxStalledCount: ANALYSIS_MAX_STALLED_COUNT,
})
export class AnalysisProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly advisoryCache: AdvisoryCacheService,
  ) {
    super();
  }

  /**
   * Clears clones and runs left behind by a previous process. Nothing is in
   * flight at boot, so every directory present is stale by definition and the
   * age threshold can be zero. Likewise a run past QUEUED belonged to the
   * previous process: left as it is, it would hold its repository's
   * in-flight slot forever and every new request would be handed the dead run.
   * QUEUED runs are kept, since their jobs are still waiting in Redis.
   */
  async onModuleInit(): Promise<void> {
    await sweepWorkspace(this.workspaceDir, { logger: this.toAnalyzerLogger('startup') });

    const { count } = await this.prisma.analysisRun.updateMany({
      where: { status: { in: ['CLONING', 'ANALYZING', 'SCANNING', 'EXPLAINING'] } },
      data: {
        status: 'FAILED',
        stage: 'failed',
        errorCode: 'interrupted',
        error: 'The analysis was interrupted by a server restart. Please run it again.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) this.logger.warn(`[run startup] marked ${count} interrupted run(s) as failed`);
  }

  /**
   * Covers failures that never reach the catch block in `process`, chiefly a
   * stalled job. Conditional on the run still being open, so a failure that
   * `process` already recorded keeps its own, more specific message.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AnalysisJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;

    const { count } = await this.prisma.analysisRun.updateMany({
      where: { id: job.data.runId, status: { notIn: ['COMPLETED', 'FAILED'] } },
      data: {
        status: 'FAILED',
        stage: 'failed',
        errorCode: 'abandoned',
        error: 'The analysis stopped responding and was abandoned.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) this.logger.error(`[run ${job.data.runId}] abandoned: ${error.message}`);
  }

  async process(job: Job<AnalysisJobData>): Promise<void> {
    const { runId, repoUrl } = job.data;
    this.logger.log(`analysing ${repoUrl} (run ${runId})`);

    // Second net, in case a previous run's own cleanup lost a race with a
    // lingering file handle. An hour is far longer than any analysis, so this
    // can never touch a clone that is still in use.
    await sweepWorkspace(this.workspaceDir, {
      minAgeMs: 60 * 60 * 1000,
      logger: this.toAnalyzerLogger(runId),
    });

    await this.updateRun(runId, { status: 'CLONING', stage: 'cloning', progress: 5 });

    try {
      const { result } = await analyzeRepository({
        repoUrl,
        workspaceDir: this.workspaceDir,
        maxFiles: this.config.get<number>('MAX_FILES', 5000),
        cloneTimeoutMs: this.config.get<number>('CLONE_TIMEOUT_MS', 300_000),
        churnWindowMonths: this.config.get<number>('CHURN_WINDOW_MONTHS', 24),
        ...this.securityOptions(),
        logger: this.toAnalyzerLogger(runId),
        onProgress: (event) => {
          // Fire-and-forget: a dropped progress update is cosmetic, and making
          // the analysis await a database write at every step would slow it
          // down for no benefit.
          void this.recordProgress(runId, event);
        },
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.fileMetric.deleteMany({ where: { analysisRunId: runId } });

        await tx.fileMetric.createMany({
          data: result.files.map((file) => ({
            analysisRunId: runId,
            path: file.path,
            loc: file.loc,
            churnCommits: file.churnCommits,
            churnLinesChanged: file.churnLinesChanged,
            bugCommits: file.bugCommits,
            cyclomaticComplexity: file.cyclomaticComplexity,
            maxNestingDepth: file.maxNestingDepth,
            churnScore: file.churnScore,
            bugScore: file.bugScore,
            complexityScore: file.complexityScore,
            bugPronenessScore: file.bugPronenessScore,
            securityScore: file.securityScore,
            securityFindings: file.securityFindings as unknown as Prisma.InputJsonValue,
          })),
        });

        await tx.analysisRun.update({
          where: { id: runId },
          data: {
            status: 'COMPLETED',
            stage: 'completed',
            progress: 100,
            errorCode: null,
            error: null,
            commitSha: result.commitSha,
            filesAnalyzed: result.filesAnalyzed,
            filesDiscovered: result.filesDiscovered,
            truncated: result.truncated,
            securityScore: result.securityScore,
            bugPronenessScore: result.bugPronenessScore,
            scanOutcomes: result.scanOutcomes as unknown as Prisma.InputJsonValue,
            repositoryFindings: result.repositoryFindings as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        });
      });

      this.logger.log(`completed ${repoUrl} in ${(result.durationMs / 1000).toFixed(1)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`failed ${repoUrl}: ${message}`);

      await this.updateRun(runId, {
        status: 'FAILED',
        stage: 'failed',
        // The code is what the user reads, translated; the message stays as
        // technical detail beneath it, so it must not be a stack trace.
        errorCode: error instanceof AnalyzerError ? error.code : 'unknown',
        error: message,
        finishedAt: new Date(),
      });

      throw error;
    }
  }

  private async recordProgress(runId: string, event: ProgressEvent): Promise<void> {
    try {
      await this.updateRun(runId, {
        status: STAGE_TO_STATUS[event.stage],
        stage: event.stage,
        progress: event.progress,
      });
    } catch (error) {
      this.logger.debug(`progress update dropped: ${describeError(error)}`);
    }
  }

  /**
   * Scanner timeouts and the source list are environment-driven for the same
   * reason MAX_FILES is: their cost on the deploy target is unverified, and
   * turning one off has to be possible without a redeploy.
   */
  private securityOptions() {
    const sources = parseSecuritySources(
      this.config.get<string>('SECURITY_SOURCES', 'semgrep,gitleaks,osv'),
    );
    const semgrepConfigs = parseSemgrepConfigs(this.config.get<string>('SEMGREP_CONFIG', ''));

    return {
      // An empty list is a deliberate "do not scan", and the analyzer reports
      // every source as skipped rather than pretending the repository is clean.
      security: sources.length > 0,
      securitySources: sources,
      semgrepTimeoutMs: this.config.get<number>('SEMGREP_TIMEOUT_MS', 600_000),
      gitleaksTimeoutMs: this.config.get<number>('GITLEAKS_TIMEOUT_MS', 300_000),
      osvTimeoutMs: this.config.get<number>('OSV_TIMEOUT_MS', 120_000),
      ...(semgrepConfigs.length > 0 ? { semgrepConfigs } : {}),
      advisoryCache: this.advisoryCache,
    };
  }

  private get workspaceDir(): string {
    return this.config.get<string>('WORKSPACE_DIR', '.debtmap-workspace');
  }

  private async updateRun(runId: string, data: Prisma.AnalysisRunUpdateInput): Promise<void> {
    await this.prisma.analysisRun.update({ where: { id: runId }, data });
  }

  private toAnalyzerLogger(runId: string): AnalyzerLogger {
    const prefix = `[run ${runId}]`;
    return {
      debug: (message, meta) => this.logger.debug(`${prefix} ${message}`, meta),
      info: (message, meta) => this.logger.log(`${prefix} ${message}`, meta),
      warn: (message, meta) => this.logger.warn(`${prefix} ${message}`, meta),
      error: (message, meta) => this.logger.error(`${prefix} ${message}`, meta),
    };
  }
}

/**
 * The analyzer reports fine-grained stages; the UI shows a coarser status. Both
 * are stored so the progress bar can be specific while the status stays stable.
 */
const STAGE_TO_STATUS: Record<ProgressEvent['stage'], RunStatus> = {
  cloning: 'CLONING',
  discovering: 'ANALYZING',
  'git-metrics': 'ANALYZING',
  'ast-metrics': 'ANALYZING',
  security: 'SCANNING',
  scoring: 'ANALYZING',
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

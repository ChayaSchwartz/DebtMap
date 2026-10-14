import { randomBytes } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  isTerminal,
  parseRepoUrl,
  type AnalysisRunResponse,
  type AnalysisRunStatusResponse,
  type FileDetailResponse,
  type FileMetricResponse,
  type RunErrorCode,
  type RunHistoryPoint,
  type ScanOutcome,
  type SecurityFinding,
} from '@debtmap/shared';
import type { Queue } from 'bullmq';
import type { AnalysisRun, FileMetric, Prisma, Repository } from '@prisma/client';
import {
  GitHubRateLimitError,
  GitHubService,
  RepositoryRejectedError,
} from '../github/github.service';
import { apiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { ANALYSIS_QUEUE, type AnalysisJobData } from './analysis.queue';

@Injectable()
export class AnalysesService {
  private readonly logger = new Logger(AnalysesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly quota: QuotaService,
    @InjectQueue(ANALYSIS_QUEUE) private readonly queue: Queue<AnalysisJobData>,
  ) {}

  async create(repoUrl: string): Promise<AnalysisRunStatusResponse> {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalidUrl',
        'That is not a public GitHub repository URL.',
      );
    }

    // Reject before touching the queue if this repository is already being
    // analysed: a second run would duplicate the work and, with concurrency 1,
    // simply block the queue behind its twin.
    const active = await this.prisma.analysisRun.findFirst({
      where: {
        repository: { url: parsed.canonical },
        status: { notIn: ['COMPLETED', 'FAILED'] },
      },
      include: { repository: true },
    });

    if (active) {
      this.logger.log(`returning in-flight run for ${parsed.canonical}`);
      return toStatusResponse(active, active.repository);
    }

    const facts = await this.describeRepository(parsed);

    const budget = await this.quota.consume('repos');
    if (!budget.allowed) {
      await this.quota.refund('repos');
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'dailyLimit',
        `The daily analysis limit of ${budget.limit} repositories has been reached. Please try again tomorrow.`,
        { limit: budget.limit },
      );
    }

    const repository = await this.prisma.repository.upsert({
      where: { url: parsed.canonical },
      create: {
        url: parsed.canonical,
        owner: parsed.owner,
        name: parsed.name,
        defaultBranch: facts.defaultBranch,
      },
      update: { defaultBranch: facts.defaultBranch },
    });

    const run = await this.prisma.analysisRun.create({
      data: {
        repositoryId: repository.id,
        status: 'QUEUED',
        stage: 'queued',
        shareSlug: generateShareSlug(),
      },
    });

    try {
      await this.queue.add(
        'analyse',
        {
          runId: run.id,
          repositoryId: repository.id,
          repoUrl: parsed.canonical,
          cloneUrl: parsed.cloneUrl,
        },
        {
          jobId: run.id,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
          // A failed analysis is nearly always deterministic — an unsupported
          // repository, a missing lockfile, a parse failure. Retrying would
          // burn the same minutes to reach the same conclusion and hold up the
          // single-slot queue while doing it.
          attempts: 1,
        },
      );
    } catch (error) {
      await this.quota.refund('repos');
      await this.prisma.analysisRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorCode: 'queueFailed',
          error: 'Could not be queued.',
          finishedAt: new Date(),
        },
      });
      throw error;
    }

    return toStatusResponse(run, repository);
  }

  private async describeRepository(parsed: NonNullable<ReturnType<typeof parseRepoUrl>>) {
    try {
      return await this.github.describe(parsed);
    } catch (error) {
      if (error instanceof GitHubRateLimitError) {
        throw apiError(HttpStatus.SERVICE_UNAVAILABLE, error.code, error.message, error.params);
      }
      if (error instanceof RepositoryRejectedError) {
        throw apiError(HttpStatus.BAD_REQUEST, error.code, error.message, error.params);
      }
      throw error;
    }
  }

  async getStatus(id: string): Promise<AnalysisRunStatusResponse> {
    const run = await this.prisma.analysisRun.findUnique({
      where: { id },
      include: { repository: true },
    });
    if (!run) throw apiError(HttpStatus.NOT_FOUND, 'analysisNotFound', 'Analysis not found.');
    return toStatusResponse(run, run.repository);
  }

  async getById(id: string): Promise<AnalysisRunResponse> {
    return this.getFull({ id });
  }

  /** Backs the public share link, which carries a slug rather than the run id. */
  async getBySlug(shareSlug: string): Promise<AnalysisRunResponse> {
    return this.getFull({ shareSlug });
  }

  private async getFull(where: Prisma.AnalysisRunWhereUniqueInput): Promise<AnalysisRunResponse> {
    const run = await this.prisma.analysisRun.findUnique({
      where,
      include: {
        repository: true,
        fileMetrics: {
          orderBy: [{ bugPronenessScore: 'desc' }, { path: 'asc' }],
          include: { explanation: { select: { id: true } } },
        },
      },
    });

    if (!run) throw apiError(HttpStatus.NOT_FOUND, 'analysisNotFound', 'Analysis not found.');

    return {
      ...toStatusResponse(run, run.repository),
      commitSha: run.commitSha,
      filesAnalyzed: run.filesAnalyzed,
      securityScore: run.securityScore,
      bugPronenessScore: run.bugPronenessScore,
      scanOutcomes: (run.scanOutcomes ?? []) as unknown as ScanOutcome[],
      repositoryFindings: (run.repositoryFindings ?? []) as unknown as SecurityFinding[],
      files: run.fileMetrics.map((file) =>
        toFileResponse(file, file.explanation !== null),
      ),
    };
  }

  async getFile(runId: string, fileId: string): Promise<FileDetailResponse> {
    const file = await this.prisma.fileMetric.findFirst({
      where: { id: fileId, analysisRunId: runId },
      include: { explanation: true },
    });

    if (!file) {
      throw apiError(HttpStatus.NOT_FOUND, 'fileNotFound', 'File not found in this analysis.');
    }

    return {
      ...toFileResponse(file, file.explanation !== null),
      explanation: file.explanation
        ? {
            summaryEn: file.explanation.summaryEn,
            summaryHe: file.explanation.summaryHe,
            recommendationEn: file.explanation.recommendationEn,
            recommendationHe: file.explanation.recommendationHe,
            primaryRiskFactor:
              file.explanation.primaryRiskFactor === 'security' ? 'security' : 'bugProneness',
            model: file.explanation.model,
            createdAt: file.explanation.createdAt.toISOString(),
          }
        : null,
      // Commit context is gathered during analysis for the AI prompt and is not
      // persisted; re-reading it here would mean re-cloning the repository.
      recentCommits: [],
    };
  }

  /** Completed runs only: an in-flight run has no scores to plot. */
  async getHistory(repoUrl: string, limit = 20): Promise<RunHistoryPoint[]> {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalidUrl',
        'That is not a public GitHub repository URL.',
      );
    }

    const runs = await this.prisma.analysisRun.findMany({
      where: {
        repository: { url: parsed.canonical },
        status: 'COMPLETED',
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
      take: Math.min(limit, 100),
    });

    return runs.map((run) => ({
      runId: run.id,
      shareSlug: run.shareSlug,
      finishedAt: run.finishedAt!.toISOString(),
      commitSha: run.commitSha,
      filesAnalyzed: run.filesAnalyzed ?? 0,
      securityScore: run.securityScore ?? 0,
      bugPronenessScore: run.bugPronenessScore ?? 0,
    }));
  }
}

function toStatusResponse(run: AnalysisRun, repository: Repository): AnalysisRunStatusResponse {
  return {
    id: run.id,
    shareSlug: run.shareSlug,
    repository: {
      id: repository.id,
      url: repository.url,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
    },
    status: run.status,
    stage: run.stage,
    progress: run.progress,
    errorCode: (run.errorCode as RunErrorCode | null) ?? null,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function toFileResponse(file: FileMetric, hasExplanation: boolean): FileMetricResponse {
  return {
    id: file.id,
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
    securityFindings: (file.securityFindings ?? []) as unknown as SecurityFinding[],
    hasExplanation,
  };
}

/**
 * 160 bits of randomness. The share link is the only thing protecting a result
 * from being enumerated, and although every analysed repository is public, the
 * fact that someone chose to analyse one need not be.
 */
function generateShareSlug(): string {
  return randomBytes(20).toString('base64url');
}

export { isTerminal };

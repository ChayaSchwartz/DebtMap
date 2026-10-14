import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiErrorCode, MessageParams, ParsedRepoUrl } from '@debtmap/shared';

export interface RepositoryFacts {
  defaultBranch: string;
  /** Reported by GitHub in kilobytes. */
  sizeKb: number;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
}

/** A reason the repository cannot be analysed, carrying the code the UI translates. */
export class RepositoryRejectedError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly params?: MessageParams,
  ) {
    super(message);
  }
}
export class RepositoryNotFoundError extends RepositoryRejectedError {}
export class RepositoryTooLargeError extends RepositoryRejectedError {}
export class GitHubRateLimitError extends RepositoryRejectedError {}

/**
 * Checks a repository before any of it is downloaded.
 *
 * Size in particular has to be known up front: discovering that a repository
 * exceeds the limit by cloning it first is exactly the outcome the limit
 * exists to prevent, and would fill a small container's disk to find out.
 */
@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly token?: string;
  private readonly maxSizeKb: number;

  constructor(config: ConfigService) {
    this.token = config.get<string>('GITHUB_TOKEN') || undefined;
    this.maxSizeKb = config.get<number>('MAX_REPO_SIZE_MB', 1024) * 1024;

    if (!this.token) {
      this.logger.warn(
        'GITHUB_TOKEN is not set; GitHub allows only 60 unauthenticated requests per hour',
      );
    }
  }

  async describe(repo: ParsedRepoUrl): Promise<RepositoryFacts> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DebtMap',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 404) {
      // GitHub returns 404 rather than 403 for a private repository the caller
      // cannot see, so this covers both "does not exist" and "not public".
      throw new RepositoryNotFoundError(
        'repoNotFound',
        `${repo.canonical} was not found. It must exist and be public.`,
        { repo: repo.canonical },
      );
    }

    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        throw new GitHubRateLimitError(
          'githubRateLimit',
          'GitHub API rate limit reached. Set GITHUB_TOKEN to raise it, or retry later.',
        );
      }
      throw new RepositoryNotFoundError('repoNotFound', `${repo.canonical} is not accessible.`, {
        repo: repo.canonical,
      });
    }

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} for ${repo.canonical}`);
    }

    const body = (await response.json()) as GitHubRepoResponse;

    if (body.private) {
      throw new RepositoryNotFoundError(
        'repoPrivate',
        'Private repositories are not supported yet.',
      );
    }

    if (body.size > this.maxSizeKb) {
      const sizeMb = Math.round(body.size / 1024);
      const limitMb = Math.round(this.maxSizeKb / 1024);
      throw new RepositoryTooLargeError(
        'repoTooLarge',
        `${repo.canonical} is ${sizeMb} MB, over the ${limitMb} MB limit.`,
        { repo: repo.canonical, sizeMb, limitMb },
      );
    }

    return {
      defaultBranch: body.default_branch || 'main',
      sizeKb: body.size,
      isPrivate: body.private,
      isArchived: body.archived,
      isFork: body.fork,
      pushedAt: body.pushed_at ?? null,
    };
  }
}

interface GitHubRepoResponse {
  default_branch: string;
  size: number;
  private: boolean;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
}

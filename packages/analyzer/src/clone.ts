import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import type { AnalyzerLogger } from './types';

export interface CloneHandle {
  dir: string;
  git: SimpleGit;
  commitSha: string;
  defaultBranch: string;
}

export interface CloneParams {
  cloneUrl: string;
  workspaceDir: string;
  timeoutMs: number;
  logger?: AnalyzerLogger;
}

/**
 * The repository is untrusted input, so git is constrained before it touches
 * it. Symlinks could redirect our later file reads outside the workspace, and
 * the `ext::` transport executes an arbitrary shell command from a submodule
 * URL. Hooks need no guard — they live in `.git/hooks`, which clone never
 * transfers.
 */
const HARDENED_CONFIG = [
  'core.symlinks=false',
  'protocol.ext.allow=never',
  'submodule.recurse=false',
  // Stops git from spawning a background `gc --auto` after the clone. That
  // process keeps the clone directory as its working directory, and Windows
  // refuses to remove a directory that is any live process's cwd — which
  // leaked an entire clone per analysis until this was set.
  'gc.auto=0',
  'maintenance.auto=false',
];

/**
 * simple-git blocks `protocol.*` overrides by default because widening the
 * allowed protocols is dangerous. We are narrowing them, which it cannot
 * distinguish, so the opt-in is required here.
 */
const UNSAFE_OPT_IN = { allowUnsafeProtocolOverride: true } as const;

/**
 * Clones at full depth. Shallow clones would be faster, but Gitleaks can only
 * find a credential that was committed and later removed if the history that
 * contained it is present — which is exactly the case worth catching.
 *
 * The caller is responsible for calling `cleanupClone` in a finally block.
 */
export async function cloneRepository(params: CloneParams): Promise<CloneHandle> {
  const dir = path.join(path.resolve(params.workspaceDir), randomUUID());
  await mkdir(dir, { recursive: true });

  const git = simpleGit({
    baseDir: dir,
    timeout: { block: params.timeoutMs },
    config: HARDENED_CONFIG,
    unsafe: UNSAFE_OPT_IN,
  }).env(nonInteractiveEnv());

  params.logger?.info('cloning repository', { url: params.cloneUrl });

  try {
    await git.clone(params.cloneUrl, dir, ['--no-tags']);

    const commitSha = (await git.revparse(['HEAD'])).trim();
    const defaultBranch = await resolveDefaultBranch(git);

    return { dir, git, commitSha, defaultBranch };
  } catch (error) {
    await cleanupClone(dir, params.logger);
    throw error;
  }
}

/**
 * A URL for a private or non-existent repository makes git ask for
 * credentials. With no terminal attached that request would block until the
 * clone timeout, turning a fast, clear "not found" into a five-minute hang.
 */
function nonInteractiveEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: '0',
  };

  // simple-git refuses to spawn when an editor or pager is present in the
  // environment it is handed. No command we run opens one, so the inherited
  // values are dropped rather than the whole environment being replaced — git
  // still needs PATH and HOME to function. Askpass helpers are dropped for the
  // same reason, and because one would defeat GIT_TERMINAL_PROMPT: VS Code sets
  // GIT_ASKPASS in every integrated terminal, so a server started there would
  // otherwise fail every clone.
  for (const key of [
    'EDITOR',
    'VISUAL',
    'GIT_EDITOR',
    'GIT_SEQUENCE_EDITOR',
    'GIT_PAGER',
    'PAGER',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
  ]) {
    delete env[key];
  }

  return env;
}

async function resolveDefaultBranch(git: SimpleGit): Promise<string> {
  try {
    const ref = await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    return ref.trim().replace(/^origin\//, '') || 'main';
  } catch {
    try {
      return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim() || 'main';
    } catch {
      return 'main';
    }
  }
}

/**
 * Never throws: cleanup failure must not mask the error that triggered it.
 *
 * Retries generously because the failure mode is a transient handle — a git
 * process winding down, or a virus scanner reading files that were just
 * written — rather than a permanent condition. Returns whether the directory
 * is actually gone so the caller can tell a leak from a success.
 */
export async function cleanupClone(dir: string, logger?: AnalyzerLogger): Promise<boolean> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return true;
  } catch (error) {
    logger?.warn('failed to remove clone directory; it will be swept later', {
      dir,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Removes clone directories left behind by earlier runs.
 *
 * This is the guarantee, not the optimisation. Per-run cleanup can fail for
 * reasons outside our control, and with clones of up to a gigabyte a handful
 * of leaks fills a small container's disk. Sweeping bounds the damage to one
 * clone regardless of how the previous process died.
 *
 * `minAgeMs` protects a clone that another run may still be using; at startup
 * nothing is in flight, so callers can pass 0.
 */
export async function sweepWorkspace(
  workspaceDir: string,
  options: { minAgeMs?: number; logger?: AnalyzerLogger } = {},
): Promise<number> {
  const { minAgeMs = 0, logger } = options;
  const root = path.resolve(workspaceDir);

  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // No workspace directory yet is the normal case on a first run.
    return 0;
  }

  const cutoff = Date.now() - minAgeMs;
  let removed = 0;

  for (const entry of entries) {
    // Clone directories are named with a UUID. Anything else in here was not
    // put there by us, and deleting it is not our call.
    if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;

    const target = path.join(root, entry.name);

    // minAgeMs of 0 means "remove everything", which is what a startup sweep
    // wants. Comparing against `now` instead would leave a directory created
    // in the same millisecond behind, on the wrong side of the boundary.
    if (minAgeMs > 0) {
      try {
        const info = await stat(target);
        if (info.mtimeMs > cutoff) continue;
      } catch {
        continue;
      }
    }

    if (await cleanupClone(target, logger)) removed += 1;
  }

  if (removed > 0) logger?.info(`swept ${removed} stale clone director${removed === 1 ? 'y' : 'ies'}`);
  return removed;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

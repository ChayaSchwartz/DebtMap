import { spawn } from 'node:child_process';
import type { ScanReason } from '@debtmap/shared';

/**
 * Why a scanner produced no usable output. The distinction matters all the way
 * up to the UI: "the tool is not installed" is an operator problem, "the tool
 * ran and found nothing" is a result, and conflating them would let a broken
 * deployment report every repository as clean.
 */
export type ToolStatus = 'ok' | 'missing' | 'timeout' | 'failed';

export interface ToolResult {
  status: ToolStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Human-readable reason, set for every status other than `ok`. */
  detail?: string;
  /** The same as a code the UI translates. */
  reason?: ScanReason;
}

export interface RunToolParams {
  command: string;
  args: readonly string[];
  /** The clone directory. Every scanner is run from inside the repository. */
  cwd: string;
  timeoutMs: number;
  /** Extra environment on top of the parent's; never replaces PATH or HOME. */
  env?: Record<string, string>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

/** 64 MiB. Semgrep's JSON on a large repository is the reason this is generous. */
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Only the tail of stderr is worth keeping: the last error is the useful one. */
const MAX_STDERR_BYTES = 64 * 1024;

/**
 * Runs an external scanner over untrusted code and always resolves — never
 * rejects.
 *
 * Every caller's contract with the pipeline is the same: a scanner that cannot
 * run degrades its own dimension and leaves the rest of the analysis intact.
 * Expressing that as a resolved `ToolResult` rather than an exception keeps
 * that rule in one place instead of in three try/catch blocks.
 *
 * `shell` is never enabled. The arguments include paths from a stranger's
 * repository, and a shell would turn a filename into a command.
 */
export function runTool(params: RunToolParams): Promise<ToolResult> {
  const started = Date.now();
  const maxOutputBytes = params.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<ToolResult>((resolve) => {
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const child = spawn(params.command, [...params.args], {
      cwd: params.cwd,
      env: { ...process.env, ...params.env } as NodeJS.ProcessEnv,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: Omit<ToolResult, 'stdout' | 'stderr' | 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
      resolve({
        ...result,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
        durationMs: Date.now() - started,
      });
    };

    const kill = () => {
      // SIGKILL rather than SIGTERM: a scanner that has already blown its
      // timeout is not going to shut down politely, and on Windows both map
      // to the same forced termination anyway.
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    };

    const timer = setTimeout(() => {
      kill();
      finish({
        status: 'timeout',
        exitCode: null,
        detail: `timed out after ${Math.round(params.timeoutMs / 1000)}s`,
        reason: { code: 'timeout', params: { seconds: Math.round(params.timeoutMs / 1000) } },
      });
    }, params.timeoutMs);

    // Node keeps the process alive for a pending timer; a scanner outliving
    // the analysis should not also hold the worker open.
    timer.unref?.();

    const onAbort = () => {
      kill();
      finish({ status: 'failed', exitCode: null, detail: 'cancelled', reason: { code: 'cancelled' } });
    };

    if (params.signal?.aborted) {
      kill();
      finish({ status: 'failed', exitCode: null, detail: 'cancelled', reason: { code: 'cancelled' } });
      return;
    }
    params.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        kill();
        finish({
          status: 'failed',
          exitCode: null,
          detail: `produced more than ${Math.round(maxOutputBytes / (1024 * 1024))}MB of output`,
          reason: {
            code: 'outputTooLarge',
            params: { megabytes: Math.round(maxOutputBytes / (1024 * 1024)) },
          },
        });
        return;
      }
      stdout.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      stderrBytes += chunk.length;
      stderr.push(chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      // ENOENT is the one failure that is not an error on our side: the binary
      // is simply not installed on this host, which is a supported state.
      finish(
        error.code === 'ENOENT'
          ? {
              status: 'missing',
              exitCode: null,
              detail: `${params.command} is not installed`,
              reason: { code: 'notInstalled', params: { tool: params.command } },
            }
          : {
              status: 'failed',
              exitCode: null,
              detail: error.message,
              reason: { code: 'unexpected' },
            },
      );
    });

    child.on('close', (code) => {
      finish({ status: 'ok', exitCode: code });
    });
  });
}

/** Trims a scanner's stderr to something that fits in a status line. */
export function summarizeStderr(stderr: string, limit = 200): string | undefined {
  const line = stderr
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .pop();

  if (!line) return undefined;
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

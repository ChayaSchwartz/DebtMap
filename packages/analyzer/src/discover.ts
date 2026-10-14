import { stat } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';

/** Per spec, the MVP analyses plain TypeScript and JavaScript only. */
const INCLUDE = ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.mts', '**/*.cts'];

/**
 * Generated, vendored, and installed code is excluded: none of it is authored
 * in this repository, so churn and complexity there say nothing about the team
 * that owns it. Test files are deliberately *not* excluded — they are code that
 * breaks and gets fixed like any other, and a churning test suite is a signal.
 */
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/third_party/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.angular/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/*.d.ts',
  '**/.git/**',
];

/**
 * Files above this size are skipped as generated. A bundle that escaped the
 * name-based excludes — `vendor-3f2a.js`, an inlined MathJax — is not code
 * anyone maintains, and parsing one synchronously holds the event loop for
 * minutes, long enough for the queue to declare the job stalled. Matches
 * Semgrep's default `--max-target-bytes`, so both dimensions skip the same files.
 */
export const MAX_SOURCE_FILE_BYTES = 1_000_000;

export interface DiscoveryResult {
  /** Repo-relative paths with forward slashes, sorted for stable output. */
  files: string[];
  discovered: number;
  truncated: boolean;
  /** Files dropped for exceeding MAX_SOURCE_FILE_BYTES. */
  oversized: string[];
}

export interface DiscoveryParams {
  dir: string;
  maxFiles: number;
}

export async function discoverFiles(params: DiscoveryParams): Promise<DiscoveryResult> {
  const matches = await glob(INCLUDE, {
    cwd: params.dir,
    ignore: EXCLUDE,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    absolute: false,
  });

  const sized = await withSizes(
    params.dir,
    matches.map((file) => file.split('\\').join('/')),
  );

  const oversized = sized.filter((entry) => entry.size > MAX_SOURCE_FILE_BYTES);
  const eligible = sized.filter((entry) => entry.size <= MAX_SOURCE_FILE_BYTES);
  const result = {
    discovered: sized.length,
    oversized: oversized.map((entry) => entry.file).sort(),
  };

  if (eligible.length <= params.maxFiles) {
    return { ...result, files: eligible.map((entry) => entry.file).sort(), truncated: false };
  }

  return { ...result, files: keepLargest(eligible, params.maxFiles).sort(), truncated: true };
}

async function withSizes(dir: string, files: string[]): Promise<{ file: string; size: number }[]> {
  return Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(path.join(dir, file));
        return { file, size: info.size };
      } catch {
        return { file, size: 0 };
      }
    }),
  );
}

/**
 * When a repository exceeds the cap we keep the largest files rather than the
 * first N in any traversal or alphabetical order. Sorting by name would drop
 * whole directories purely because of where they fall in the alphabet, which
 * silently hides entire subsystems. Size is a crude proxy for substance, but a
 * one-line barrel export is genuinely less likely to be a risk hotspot than a
 * thousand-line module.
 */
function keepLargest(sized: readonly { file: string; size: number }[], limit: number): string[] {
  return [...sized]
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map((entry) => entry.file);
}

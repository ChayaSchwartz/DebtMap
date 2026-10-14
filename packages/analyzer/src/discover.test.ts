import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_SOURCE_FILE_BYTES, discoverFiles } from './discover';

describe('discoverFiles', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'debtmap-discover-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  const write = async (file: string, bytes: number): Promise<void> => {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), 'x'.repeat(bytes), 'utf8');
  };

  it('skips files above the size limit as generated, and reports them', async () => {
    await write('src/app.ts', 100);
    await write('src/katex/mathjaxsvg.js', MAX_SOURCE_FILE_BYTES + 1);

    const result = await discoverFiles({ dir, maxFiles: 100 });

    expect(result.files).toEqual(['src/app.ts']);
    expect(result.oversized).toEqual(['src/katex/mathjaxsvg.js']);
    expect(result.discovered).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('keeps a file exactly at the limit', async () => {
    await write('big.ts', MAX_SOURCE_FILE_BYTES);

    const result = await discoverFiles({ dir, maxFiles: 100 });

    expect(result.files).toEqual(['big.ts']);
    expect(result.oversized).toEqual([]);
  });

  it('applies the file cap after dropping oversized files, keeping the largest', async () => {
    await write('a.ts', 10);
    await write('b.ts', 300);
    await write('c.ts', 200);
    await write('generated.js', MAX_SOURCE_FILE_BYTES + 1);

    const result = await discoverFiles({ dir, maxFiles: 2 });

    expect(result.files).toEqual(['b.ts', 'c.ts']);
    expect(result.truncated).toBe(true);
  });

  it('still excludes by path', async () => {
    await write('node_modules/lib/index.js', 10);
    await write('dist/out.js', 10);
    await write('src/index.ts', 10);

    const result = await discoverFiles({ dir, maxFiles: 100 });

    expect(result.files).toEqual(['src/index.ts']);
  });
});

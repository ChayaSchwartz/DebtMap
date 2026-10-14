import { describe, expect, it } from 'vitest';
import { runTool, summarizeStderr } from './process';

const cwd = process.cwd();

describe('runTool', () => {
  it('returns the tool output and exit code', async () => {
    const result = await runTool({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("scanned")'],
      cwd,
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({ status: 'ok', exitCode: 0, stdout: 'scanned' });
  });

  it('reports a non-zero exit as a completed run, since scanners exit non-zero on findings', async () => {
    const result = await runTool({
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      cwd,
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({ status: 'ok', exitCode: 1 });
  });

  it('distinguishes an uninstalled tool from a broken one', async () => {
    const result = await runTool({
      command: 'debtmap-nonexistent-scanner',
      args: [],
      cwd,
      timeoutMs: 30_000,
    });

    expect(result.status).toBe('missing');
    expect(result.detail).toContain('not installed');
    expect(result.reason?.code).toBe('notInstalled');
  });

  it('kills a tool that overruns its budget', async () => {
    const result = await runTool({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd,
      timeoutMs: 300,
    });

    expect(result.status).toBe('timeout');
    expect(result.detail).toContain('timed out');
    expect(result.reason?.code).toBe('timeout');
  });

  it('stops a tool that floods stdout instead of buffering it into an OOM', async () => {
    const result = await runTool({
      command: process.execPath,
      args: ['-e', 'for (;;) process.stdout.write("x".repeat(65536));'],
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 256 * 1024,
    });

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('output');
    expect(result.reason?.code).toBe('outputTooLarge');
  });

  it('stops when the analysis is cancelled', async () => {
    const controller = new AbortController();
    const pending = runTool({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd,
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    controller.abort();

    expect((await pending).detail).toBe('cancelled');
  });
});

describe('summarizeStderr', () => {
  it('keeps the last meaningful line', () => {
    expect(summarizeStderr('warming up\n\nfatal: rule not found\n')).toBe('fatal: rule not found');
  });

  it('truncates so a status line stays a line', () => {
    expect(summarizeStderr('x'.repeat(500))).toHaveLength(200);
  });

  it('returns nothing when the tool said nothing', () => {
    expect(summarizeStderr('  \n ')).toBeUndefined();
  });
});

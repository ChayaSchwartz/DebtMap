import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupClone, sweepWorkspace } from './clone';

describe('sweepWorkspace', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'debtmap-sweep-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  const makeClone = async (name = randomUUID()): Promise<string> => {
    const dir = path.join(workspace, name);
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, 'index.ts'), 'export const a = 1;\n', 'utf8');
    return dir;
  };

  const exists = async (dir: string): Promise<boolean> => {
    try {
      await access(dir);
      return true;
    } catch {
      return false;
    }
  };

  it('removes clone directories left behind by an earlier run', async () => {
    const first = await makeClone();
    const second = await makeClone();

    const removed = await sweepWorkspace(workspace);

    expect(removed).toBe(2);
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(false);
  });

  it('leaves directories that are newer than the age threshold', async () => {
    // Protects a clone another run may still be writing to.
    const inFlight = await makeClone();

    const removed = await sweepWorkspace(workspace, { minAgeMs: 60_000 });

    expect(removed).toBe(0);
    expect(await exists(inFlight)).toBe(true);
  });

  it('ignores anything not named like one of our clones', async () => {
    // The workspace directory could be shared or misconfigured; deleting
    // files we did not create is not our call.
    const foreign = path.join(workspace, 'important-data');
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, 'notes.txt'), 'keep me', 'utf8');

    const removed = await sweepWorkspace(workspace);

    expect(removed).toBe(0);
    expect(await exists(foreign)).toBe(true);
  });

  it('reports zero rather than throwing when the workspace does not exist yet', async () => {
    await expect(sweepWorkspace(path.join(workspace, 'never-created'))).resolves.toBe(0);
  });
});

describe('cleanupClone', () => {
  it('reports success so a caller can distinguish a removal from a leak', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'debtmap-clean-'));
    const dir = path.join(workspace, randomUUID());
    await mkdir(dir, { recursive: true });

    await expect(cleanupClone(dir)).resolves.toBe(true);

    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('treats an already-absent directory as removed', async () => {
    await expect(cleanupClone(path.join(tmpdir(), `debtmap-missing-${randomUUID()}`))).resolves.toBe(
      true,
    );
  });
});

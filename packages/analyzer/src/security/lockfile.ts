import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { normalizeScannerPath } from './types';

export interface LockedPackage {
  name: string;
  version: string;
  /** The lockfile this resolution came from; set by `collectLockedPackages`. */
  lockfile?: string;
}

export interface LockfileScan {
  /** Repo-relative paths of the lockfiles that were read. */
  lockfiles: string[];
  /** Unique `name@version` pairs across every lockfile found. */
  packages: LockedPackage[];
}

/**
 * `npm audit` is not used, and this file is the reason the alternative exists.
 *
 * Running `npm audit` requires an install first, and installing means executing
 * `postinstall` scripts from a stranger's repository on our server. A lockfile
 * is just JSON: reading it tells us every resolved package and version without
 * running a single line of the code under analysis.
 */
export async function collectLockedPackages(dir: string): Promise<LockfileScan> {
  const matches = await glob(['**/package-lock.json', '**/npm-shrinkwrap.json'], {
    cwd: dir,
    ignore: ['**/node_modules/**', '**/.git/**'],
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    absolute: false,
  });

  const lockfiles = matches.map(normalizeScannerPath).sort();
  const unique = new Map<string, LockedPackage>();
  const read: string[] = [];

  for (const lockfile of lockfiles) {
    let content: string;
    try {
      content = await readFile(path.join(dir, lockfile), 'utf8');
    } catch {
      continue;
    }

    let parsed: LockedPackage[];
    try {
      parsed = parsePackageLock(content);
    } catch {
      // A malformed lockfile is the repository's problem, not a reason to fail
      // the dependency scan for the lockfiles that do parse.
      continue;
    }

    read.push(lockfile);
    for (const entry of parsed) {
      // First lockfile wins. A monorepo can resolve the same version in
      // several workspaces, and reporting one advisory once per workspace
      // would inflate the count without adding a distinct fix.
      const key = `${entry.name}@${entry.version}`;
      if (!unique.has(key)) unique.set(key, { ...entry, lockfile });
    }
  }

  return { lockfiles: read, packages: [...unique.values()] };
}

/**
 * Handles both lockfile generations. v2 and v3 use the flat `packages` map; v1,
 * still common in older repositories, nests `dependencies` recursively.
 *
 * Development dependencies are included. They run on developer machines and in
 * CI, which is where build-time supply chain attacks land, and excluding them
 * would report a repository whose test runner has a critical advisory as clean.
 */
export function parsePackageLock(content: string): LockedPackage[] {
  const raw = JSON.parse(content) as PackageLockJson;
  const found = new Map<string, LockedPackage>();

  const add = (name: string | undefined, version: string | undefined) => {
    if (!name || !version) return;
    // Aliases, git URLs, and `file:` paths are not resolvable to an OSV
    // package/version pair, and asking about them returns noise.
    if (!/^\d+\.\d+\.\d+/.test(version)) return;
    found.set(`${name}@${version}`, { name, version });
  };

  if (raw.packages && typeof raw.packages === 'object') {
    for (const [key, entry] of Object.entries(raw.packages)) {
      // The empty key is the project itself, and a link is a workspace symlink
      // pointing at another entry that is already listed.
      if (!key || entry?.link) continue;
      add(entry?.name ?? packageNameFromPath(key), entry?.version);
    }
  }

  if (raw.dependencies && typeof raw.dependencies === 'object') {
    walkV1Dependencies(raw.dependencies, add);
  }

  return [...found.values()];
}

function walkV1Dependencies(
  dependencies: Record<string, V1Dependency>,
  add: (name: string | undefined, version: string | undefined) => void,
): void {
  for (const [name, entry] of Object.entries(dependencies)) {
    if (!entry) continue;
    add(name, entry.version);
    if (entry.dependencies) walkV1Dependencies(entry.dependencies, add);
  }
}

/**
 * `node_modules/@scope/name/node_modules/dep` resolves to `dep`: only the last
 * segment after the final `node_modules/` names the installed package.
 */
export function packageNameFromPath(key: string): string | undefined {
  const marker = 'node_modules/';
  const index = key.lastIndexOf(marker);
  if (index === -1) return undefined;
  const name = key.slice(index + marker.length);
  return name || undefined;
}

interface PackageLockJson {
  packages?: Record<string, { name?: string; version?: string; link?: boolean } | undefined>;
  dependencies?: Record<string, V1Dependency>;
}

interface V1Dependency {
  version?: string;
  dependencies?: Record<string, V1Dependency>;
}

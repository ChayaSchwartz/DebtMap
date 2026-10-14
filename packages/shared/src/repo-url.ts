export interface ParsedRepoUrl {
  owner: string;
  name: string;
  /** Canonical form used as the database key: `github.com/owner/name`. */
  canonical: string;
  cloneUrl: string;
}

/** GitHub allows alphanumerics, hyphen, underscore, and dot in both segments. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

const RESERVED_OWNERS = new Set([
  'features',
  'settings',
  'marketplace',
  'explore',
  'topics',
  'collections',
  'sponsors',
  'orgs',
  'apps',
  'notifications',
  'pulls',
  'issues',
]);

/**
 * Accepts the forms people actually paste: a browser URL with or without
 * scheme, a deep link into a file or branch, an `.git` suffix, or an SSH
 * remote. Returns null rather than throwing so callers choose the error shape.
 *
 * Only github.com is accepted — the MVP analyses public GitHub repositories.
 */
export function parseRepoUrl(input: string): ParsedRepoUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const sshMatch = /^git@github\.com:(.+)$/i.exec(trimmed);
  const repoPath = sshMatch
    ? (sshMatch[1] ?? null)
    : stripHost(trimmed.replace(/^git\+/i, ''));

  if (!repoPath) return null;

  const segments = repoPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0]!;
  const name = segments[1]!.replace(/\.git$/i, '');

  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  if (name === '.' || name === '..') return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;

  const canonical = `github.com/${owner}/${name}`;
  return { owner, name, canonical, cloneUrl: `https://${canonical}.git` };
}

/** Strips scheme, credentials, and the github.com host, leaving `owner/name/...`. */
function stripHost(value: string): string | null {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutCredentials = withoutScheme.replace(/^[^/@]*@/, '');
  const [hostAndPath] = withoutCredentials.split(/[?#]/);
  if (!hostAndPath) return null;

  const slash = hostAndPath.indexOf('/');
  if (slash === -1) return null;

  const host = hostAndPath.slice(0, slash).toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  return hostAndPath.slice(slash + 1);
}

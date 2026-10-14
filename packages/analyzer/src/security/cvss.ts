import type { Severity } from '@debtmap/shared';

/**
 * Base-score arithmetic for CVSS v3.0/v3.1, per the specification's formulas.
 *
 * OSV publishes a vector string, not a number, and the numeric score is what
 * lets a severity be compared across advisories from different databases. The
 * formulas are fixed and short enough that computing them beats adding a
 * dependency for arithmetic that will never change.
 *
 * Only the base metrics are read. Temporal and environmental metrics describe a
 * specific deployment, which we know nothing about.
 */

const ATTACK_VECTOR: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const ATTACK_COMPLEXITY: Record<string, number> = { L: 0.77, H: 0.44 };
const USER_INTERACTION: Record<string, number> = { N: 0.85, R: 0.62 };
const IMPACT: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

/** Privileges Required is worth more to an attacker when it can escape scope. */
const PRIVILEGES_REQUIRED_UNCHANGED: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PRIVILEGES_REQUIRED_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

/** Returns null for vectors that are not CVSS v3, or that omit a base metric. */
export function cvssV3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//i.test(vector.trim())) return null;

  const metrics = new Map<string, string>();
  for (const part of vector.trim().split('/').slice(1)) {
    const [key, value] = part.split(':');
    if (key && value) metrics.set(key.toUpperCase(), value.toUpperCase());
  }

  const scopeChanged = metrics.get('S') === 'C';

  const av = ATTACK_VECTOR[metrics.get('AV') ?? ''];
  const ac = ATTACK_COMPLEXITY[metrics.get('AC') ?? ''];
  const ui = USER_INTERACTION[metrics.get('UI') ?? ''];
  const pr = (scopeChanged ? PRIVILEGES_REQUIRED_CHANGED : PRIVILEGES_REQUIRED_UNCHANGED)[
    metrics.get('PR') ?? ''
  ];
  const c = IMPACT[metrics.get('C') ?? ''];
  const i = IMPACT[metrics.get('I') ?? ''];
  const a = IMPACT[metrics.get('A') ?? ''];

  if ([av, ac, ui, pr, c, i, a].some((value) => value === undefined)) return null;

  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);

  return roundUp(raw);
}

/**
 * CVSS rounds *up* to one decimal, not to nearest. The integer detour is the
 * specification's own workaround for floating-point representation: 8.799…
 * must become 8.8 rather than 8.9.
 */
function roundUp(value: number): number {
  const scaled = Math.round(value * 100_000);
  return scaled % 10_000 === 0 ? scaled / 100_000 : (Math.floor(scaled / 10_000) + 1) / 10;
}

/** The qualitative bands defined alongside the numeric scale. */
export function severityFromCvss(score: number): Severity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

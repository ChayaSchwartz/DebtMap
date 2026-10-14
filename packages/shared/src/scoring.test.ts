import { describe, expect, it } from 'vitest';
import {
  computeAbsoluteBugProneness,
  computeBugProneness,
  computeSecurityScore,
  saturatingScore,
  toRiskBand,
} from './scoring';

describe('computeBugProneness', () => {
  it('applies the 0.3 / 0.4 / 0.3 weighting', () => {
    expect(computeBugProneness({ churnScore: 100, bugScore: 0, complexityScore: 0 })).toBe(30);
    expect(computeBugProneness({ churnScore: 0, bugScore: 100, complexityScore: 0 })).toBe(40);
    expect(computeBugProneness({ churnScore: 0, bugScore: 0, complexityScore: 100 })).toBe(30);
  });

  it('gives bug history the most influence of the three', () => {
    const bugHeavy = computeBugProneness({ churnScore: 0, bugScore: 100, complexityScore: 0 });
    const churnHeavy = computeBugProneness({ churnScore: 100, bugScore: 0, complexityScore: 0 });
    expect(bugHeavy).toBeGreaterThan(churnHeavy);
  });
});

describe('computeSecurityScore', () => {
  it('reports nothing for a file with no findings', () => {
    expect(computeSecurityScore([])).toBe(0);
  });

  it('is driven by the worst finding, not the number of them', () => {
    const oneCritical = computeSecurityScore(['critical']);
    const manyLows = computeSecurityScore(['low', 'low', 'low', 'low', 'low', 'low']);
    expect(oneCritical).toBeGreaterThan(manyLows);
  });

  it('nudges upward when the worst severity repeats', () => {
    expect(computeSecurityScore(['high', 'high'])).toBeGreaterThan(computeSecurityScore(['high']));
  });

  it('caps the volume bonus so severity always dominates', () => {
    const manyHighs = computeSecurityScore(Array<'high'>(50).fill('high'));
    expect(manyHighs).toBeLessThan(computeSecurityScore(['critical']));
  });
});

describe('saturatingScore', () => {
  it('returns 50 at the midpoint', () => {
    expect(saturatingScore(40, 40)).toBe(50);
  });

  it('keeps ranking extreme values instead of clipping them', () => {
    expect(saturatingScore(2000, 40)).toBeGreaterThan(saturatingScore(400, 40));
    expect(saturatingScore(2000, 40)).toBeLessThan(100);
  });

  it('treats absent measurements as zero risk', () => {
    expect(saturatingScore(0, 40)).toBe(0);
    expect(saturatingScore(-5, 40)).toBe(0);
  });
});

describe('computeAbsoluteBugProneness', () => {
  it('separates two repositories that percentile ranks would score identically', () => {
    const calm = computeAbsoluteBugProneness({
      churnCommits: 2,
      bugCommits: 0,
      cyclomaticComplexity: 6,
    });
    const troubled = computeAbsoluteBugProneness({
      churnCommits: 60,
      bugCommits: 30,
      cyclomaticComplexity: 400,
    });

    expect(troubled).toBeGreaterThan(calm + 40);
  });

  it('moves when a file genuinely improves, so trends are meaningful', () => {
    const before = computeAbsoluteBugProneness({
      churnCommits: 30,
      bugCommits: 12,
      cyclomaticComplexity: 200,
    });
    const after = computeAbsoluteBugProneness({
      churnCommits: 30,
      bugCommits: 12,
      cyclomaticComplexity: 40,
    });

    expect(after).toBeLessThan(before);
  });
});

describe('toRiskBand', () => {
  it('maps scores to the bands the UI renders', () => {
    expect(toRiskBand(95)).toBe('critical');
    expect(toRiskBand(75)).toBe('high');
    expect(toRiskBand(50)).toBe('moderate');
    expect(toRiskBand(10)).toBe('low');
  });
});

import { describe, expect, it } from 'vitest';
import { aggregateBugProneness, aggregateSecurity, percentileRanks } from './normalize';

describe('percentileRanks', () => {
  it('spreads a distinct set across the full range', () => {
    expect(percentileRanks([1, 2, 3, 4, 5])).toEqual([0, 25, 50, 75, 100]);
  });

  it('preserves the input order, not the sorted order', () => {
    expect(percentileRanks([5, 1, 3])).toEqual([100, 0, 50]);
  });

  it('gives tied values the same rank', () => {
    const ranks = percentileRanks([10, 10, 10, 50]);
    expect(ranks[0]).toBe(ranks[1]);
    expect(ranks[1]).toBe(ranks[2]);
    expect(ranks[3]).toBe(100);
  });

  it('scores a uniform repository as uniformly unremarkable', () => {
    expect(percentileRanks([7, 7, 7, 7])).toEqual([0, 0, 0, 0]);
  });

  it('does not flag a lone file as maximum risk', () => {
    // With one file there is no distribution to rank against; scoring it 100
    // would be an artefact of the sample size rather than a finding.
    expect(percentileRanks([999])).toEqual([0]);
  });

  it('returns nothing for an empty repository', () => {
    expect(percentileRanks([])).toEqual([]);
  });

  it('is unmoved by an extreme outlier, unlike min-max scaling', () => {
    const withoutOutlier = percentileRanks([1, 2, 3, 4]);
    const withOutlier = percentileRanks([1, 2, 3, 4, 100_000]);
    // The relative ordering of the original four is preserved rather than
    // being crushed toward zero by the outlier.
    expect(withOutlier[0]).toBeLessThan(withOutlier[1]!);
    expect(withOutlier[1]).toBeLessThan(withOutlier[2]!);
    expect(withoutOutlier[3]).toBe(100);
  });
});

describe('aggregateBugProneness', () => {
  it('reflects the worst files rather than the average one', () => {
    const mostlyClean = [0, 0, 0, 0, 0, 0, 0, 0, 0, 95];
    // A plain mean would report 9.5 and call this repository healthy.
    expect(aggregateBugProneness(mostlyClean)).toBeGreaterThan(50);
  });

  it('distinguishes a calm codebase from a troubled one', () => {
    const calm = aggregateBugProneness([10, 12, 8, 15, 9]);
    const troubled = aggregateBugProneness([80, 85, 90, 75, 88]);
    expect(troubled).toBeGreaterThan(calm);
  });

  it('returns zero for an empty file set', () => {
    expect(aggregateBugProneness([])).toBe(0);
  });
});

describe('aggregateSecurity', () => {
  it('is driven by the single worst file, never diluted by clean ones', () => {
    const oneCriticalInALargeRepo = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 92];
    expect(aggregateSecurity(oneCriticalInALargeRepo)).toBe(92);
  });

  it('reports zero when nothing was found', () => {
    expect(aggregateSecurity([0, 0, 0])).toBe(0);
    expect(aggregateSecurity([])).toBe(0);
  });
});

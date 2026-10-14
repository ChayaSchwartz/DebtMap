import { describe, expect, it } from 'vitest';
import { parseGitleaksReport, toGitleaksSeverity } from './gitleaks';

describe('toGitleaksSeverity', () => {
  it('treats a matched provider credential as critical', () => {
    expect(toGitleaksSeverity('aws-access-token')).toBe('critical');
    expect(toGitleaksSeverity('private-key')).toBe('critical');
    expect(toGitleaksSeverity('stripe-access-token')).toBe('critical');
  });

  it('ranks shape-and-entropy rules below confirmed provider formats', () => {
    expect(toGitleaksSeverity('generic-api-key')).toBe('high');
    expect(toGitleaksSeverity('high-entropy-string')).toBe('high');
  });
});

describe('parseGitleaksReport', () => {
  const report = JSON.stringify([
    {
      Description: 'AWS Access Key',
      File: 'config/secrets.ts',
      RuleID: 'aws-access-token',
      StartLine: 12,
      Commit: 'a'.repeat(40),
      Secret: 'REDACTED',
    },
    {
      Description: 'AWS Access Key',
      File: 'config/secrets.ts',
      RuleID: 'aws-access-token',
      StartLine: 12,
      Commit: 'b'.repeat(40),
      Secret: 'REDACTED',
    },
    {
      Description: 'Generic API Key',
      File: 'deleted\\legacy.env',
      RuleID: 'generic-api-key',
      StartLine: 3,
      Commit: 'c'.repeat(40),
    },
  ]);

  it('records the commit a secret was found in', () => {
    const findings = parseGitleaksReport(report);

    expect(findings[0]).toEqual({
      source: 'gitleaks',
      severity: 'critical',
      ruleId: 'aws-access-token',
      title: 'AWS Access Key',
      line: 12,
      commitSha: 'a'.repeat(40),
      filePath: 'config/secrets.ts',
    });
  });

  it('collapses one secret carried by many commits into a single finding', () => {
    // The two AWS entries are the same credential at the same line, seen in two
    // commits. Counting them twice would let one leak dominate the repository.
    const findings = parseGitleaksReport(report);
    expect(findings).toHaveLength(2);
    expect(findings.filter((finding) => finding.ruleId === 'aws-access-token')).toHaveLength(1);
  });

  it('keeps findings from paths that no longer exist', () => {
    const findings = parseGitleaksReport(report);
    expect(findings[1]?.filePath).toBe('deleted/legacy.env');
  });

  it('reads the empty file gitleaks writes when it finds nothing', () => {
    expect(parseGitleaksReport('')).toEqual([]);
    expect(parseGitleaksReport('   ')).toEqual([]);
    expect(parseGitleaksReport('[]')).toEqual([]);
  });
});

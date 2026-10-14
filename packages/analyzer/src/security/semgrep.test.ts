import { describe, expect, it } from 'vitest';
import { parseSemgrepOutput, toSeverity } from './semgrep';

describe('toSeverity', () => {
  it('reserves critical for rules that claim both high impact and high likelihood', () => {
    expect(toSeverity('ERROR', { impact: 'HIGH', likelihood: 'HIGH' })).toBe('critical');
    expect(toSeverity('ERROR', { impact: 'HIGH', likelihood: 'LOW' })).toBe('high');
    expect(toSeverity('ERROR')).toBe('high');
  });

  it('discounts rules that admit low confidence', () => {
    expect(toSeverity('ERROR', { confidence: 'LOW' })).toBe('medium');
    expect(toSeverity('WARNING', { confidence: 'LOW' })).toBe('low');
    expect(toSeverity('WARNING', { confidence: 'HIGH' })).toBe('medium');
  });

  it('accepts the vocabulary newer semgrep versions emit directly', () => {
    expect(toSeverity('CRITICAL')).toBe('critical');
    expect(toSeverity('MEDIUM')).toBe('medium');
  });

  it('falls back to info for anything it does not recognise', () => {
    expect(toSeverity(undefined)).toBe('info');
    expect(toSeverity('EXPERIMENT')).toBe('info');
  });
});

describe('parseSemgrepOutput', () => {
  const output = JSON.stringify({
    results: [
      {
        check_id: 'javascript.express.security.audit.xss.direct-response-write',
        path: './src/server.ts',
        start: { line: 42 },
        extra: {
          message: 'Detected directly writing user input   to the response.\nThis is XSS.',
          severity: 'ERROR',
          metadata: {
            impact: 'HIGH',
            likelihood: 'HIGH',
            references: ['not-a-url', 'https://owasp.org/xss'],
          },
        },
      },
      {
        check_id: 'javascript.lang.security.audit.unsafe-regex',
        path: 'lib\\util.js',
        extra: { severity: 'WARNING', metadata: { shortlink: 'https://sg.run/abc' } },
      },
      { check_id: 'no.path.rule', extra: { severity: 'INFO' } },
    ],
    errors: [{ message: 'Syntax error in src/broken.ts' }],
  });

  it('maps semgrep results onto the shared finding shape', () => {
    const { findings } = parseSemgrepOutput(output);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      source: 'semgrep',
      severity: 'critical',
      ruleId: 'javascript.express.security.audit.xss.direct-response-write',
      title: 'Detected directly writing user input to the response. This is XSS.',
      line: 42,
      referenceUrl: 'https://owasp.org/xss',
      filePath: 'src/server.ts',
    });
  });

  it('normalises paths to the form discovery produces', () => {
    const { findings } = parseSemgrepOutput(output);
    expect(findings[1]?.filePath).toBe('lib/util.js');
  });

  it('omits the line when semgrep reported none', () => {
    const { findings } = parseSemgrepOutput(output);
    expect(findings[1]).not.toHaveProperty('line');
  });

  it('surfaces per-file errors so a partial scan is not reported as a clean one', () => {
    expect(parseSemgrepOutput(output).errors).toEqual(['Syntax error in src/broken.ts']);
  });

  it('treats an empty result set as a result, not a failure', () => {
    expect(parseSemgrepOutput('{"results":[],"errors":[]}')).toEqual({ findings: [], errors: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { cvssV3BaseScore, severityFromCvss } from './cvss';

describe('cvssV3BaseScore', () => {
  // Published base scores, so a change to the arithmetic fails loudly rather
  // than shifting every advisory's severity by a tenth of a point.
  it.each([
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 7.5],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
    ['CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:N/I:N/A:N', 0],
  ])('scores %s as %s', (vector, expected) => {
    expect(cvssV3BaseScore(vector)).toBe(expected);
  });

  it('ignores vectors it cannot score rather than guessing', () => {
    expect(cvssV3BaseScore('AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBeNull();
    expect(cvssV3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N')).toBeNull();
    expect(cvssV3BaseScore('CVSS:3.1/AV:N/AC:L')).toBeNull();
  });
});

describe('severityFromCvss', () => {
  it.each([
    [9.8, 'critical'],
    [9, 'critical'],
    [7, 'high'],
    [6.9, 'medium'],
    [4, 'medium'],
    [3.9, 'low'],
    [0, 'info'],
  ])('bands %s as %s', (score, expected) => {
    expect(severityFromCvss(score)).toBe(expected);
  });
});

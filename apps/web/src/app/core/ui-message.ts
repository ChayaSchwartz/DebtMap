import type { MessageParams, RiskBand, ScanReason, Severity } from '@debtmap/shared';

/**
 * Text to show, as a translation key rather than a translated string.
 *
 * Pages keep the key and translate it in the template, so a message already on
 * screen follows the language toggle. Translating at the moment an error
 * arrives would freeze it in whichever language was active then.
 */
export interface UiMessage {
  key: string;
  params?: MessageParams;
}

export function scanReasonMessage(reason: ScanReason): UiMessage {
  return { key: `scanReason.${reason.code}`, ...(reason.params ? { params: reason.params } : {}) };
}

/**
 * Findings carry a severity; the UI paints bands. Medium maps to `moderate`
 * rather than to its own colour so a dependency advisory and a file score at
 * the same level look the same.
 */
export const SEVERITY_BANDS: Readonly<Record<Severity, RiskBand>> = {
  critical: 'critical',
  high: 'high',
  medium: 'moderate',
  low: 'low',
  info: 'low',
};

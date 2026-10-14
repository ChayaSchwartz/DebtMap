/**
 * Messages the server sends for the UI to show.
 *
 * The server never sends prose for display: it sends a code, and the UI looks
 * the code up in its translation files. Prose from the server would arrive in
 * one language and stay in it when the reader switches. The English `detail` or
 * `message` that travels alongside is for logs and for whoever is debugging; the
 * UI shows it only as secondary technical text.
 */
export type MessageParams = Readonly<Record<string, string | number>>;

export interface MessageRef<Code extends string> {
  code: Code;
  params?: MessageParams;
}

/** Why an HTTP request to the API was rejected. Translation keys: `apiError.<code>`. */
export const API_ERROR_CODES = [
  'invalidUrl',
  'repoNotFound',
  'repoPrivate',
  'repoTooLarge',
  'githubRateLimit',
  'dailyLimit',
  'analysisNotFound',
  'fileNotFound',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The JSON body of an API error response. */
export interface ApiErrorBody {
  statusCode: number;
  /** English, for logs and API clients other than the web app. */
  message: string;
  code: ApiErrorCode;
  params?: MessageParams;
}

/** Why an analysis run failed. Translation keys: `runError.<code>`. */
export const RUN_ERROR_CODES = [
  'noSourceFiles',
  'cloneFailed',
  'cancelled',
  'interrupted',
  'abandoned',
  'queueFailed',
  'unknown',
] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

/** Why a scanner was skipped or failed. Translation keys: `scanReason.<code>`. */
export const SCAN_REASON_CODES = [
  'notInstalled',
  'notEnabled',
  'timeout',
  'cancelled',
  'outputTooLarge',
  'badOutput',
  'noLockfile',
  'noResolvedPackages',
  'httpError',
  'partialLookups',
  'unexpected',
] as const;
export type ScanReasonCode = (typeof SCAN_REASON_CODES)[number];
export type ScanReason = MessageRef<ScanReasonCode>;

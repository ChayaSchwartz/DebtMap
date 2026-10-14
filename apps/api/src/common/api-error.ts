import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode, MessageParams } from '@debtmap/shared';

/**
 * An HTTP error the web app can translate.
 *
 * The body carries a code for the UI to look up, so a message reaches the user
 * in the language they are reading in. `message` stays English for logs and
 * for API clients other than the web app.
 */
export function apiError(
  status: HttpStatus,
  code: ApiErrorCode,
  message: string,
  params?: MessageParams,
): HttpException {
  const body: ApiErrorBody = { statusCode: status, message, code, ...(params ? { params } : {}) };
  return new HttpException(body, status);
}

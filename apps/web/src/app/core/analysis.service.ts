import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  API_ERROR_CODES,
  type AnalysisRunResponse,
  type AnalysisRunStatusResponse,
  type ApiErrorBody,
  type ApiErrorCode,
  type FileDetailResponse,
  type RunHistoryPoint,
} from '@debtmap/shared';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import type { UiMessage } from './ui-message';

export class AnalysisError extends Error {
  constructor(
    message: string,
    /** What to show the user, translated in the template. */
    readonly uiMessage: UiMessage,
    readonly status: number,
  ) {
    super(message);
  }
}

/** For anything that is not an `AnalysisError`. */
export const GENERIC_ERROR: UiMessage = { key: 'error.generic' };

export function toUiMessage(error: unknown): UiMessage {
  return error instanceof AnalysisError ? error.uiMessage : GENERIC_ERROR;
}

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/analyses';

  start(repoUrl: string): Observable<AnalysisRunStatusResponse> {
    return this.http
      .post<AnalysisRunStatusResponse>(this.base, { repoUrl })
      .pipe(catchError(toAnalysisError));
  }

  status(id: string): Observable<AnalysisRunStatusResponse> {
    return this.http
      .get<AnalysisRunStatusResponse>(`${this.base}/${id}/status`)
      .pipe(catchError(toAnalysisError));
  }

  result(id: string): Observable<AnalysisRunResponse> {
    return this.http.get<AnalysisRunResponse>(`${this.base}/${id}`).pipe(catchError(toAnalysisError));
  }

  shared(slug: string): Observable<AnalysisRunResponse> {
    return this.http
      .get<AnalysisRunResponse>(`${this.base}/shared/${slug}`)
      .pipe(catchError(toAnalysisError));
  }

  file(runId: string, fileId: string): Observable<FileDetailResponse> {
    return this.http
      .get<FileDetailResponse>(`${this.base}/${runId}/files/${fileId}`)
      .pipe(catchError(toAnalysisError));
  }

  history(repoUrl: string): Observable<RunHistoryPoint[]> {
    return this.http
      .get<RunHistoryPoint[]>(`${this.base}/history`, { params: { repoUrl } })
      .pipe(catchError(toAnalysisError));
  }
}

/**
 * Maps a failed request onto a translation key, so the message reaches the
 * user in the language they are reading in. The API sends a code for every
 * error it raises on purpose; the status-based fallbacks cover the few it does
 * not, such as request validation, and transport failures with no body at all.
 */
function toAnalysisError(error: HttpErrorResponse): Observable<never> {
  const body = error.error as Partial<ApiErrorBody> | null;
  const message = extractMessage(error);
  return throwError(() => new AnalysisError(message, describe(error.status, body), error.status));
}

function describe(status: number, body: Partial<ApiErrorBody> | null): UiMessage {
  if (body?.code && (API_ERROR_CODES as readonly string[]).includes(body.code)) {
    return { key: `apiError.${body.code}`, ...(body.params ? { params: body.params } : {}) };
  }

  const fallback: Partial<Record<number, ApiErrorCode>> = {
    // The only request with a body is the one carrying the repository URL.
    400: 'invalidUrl',
    404: 'analysisNotFound',
  };
  const code = fallback[status];
  return code ? { key: `apiError.${code}` } : GENERIC_ERROR;
}

function extractMessage(error: HttpErrorResponse): string {
  const body = error.error as { message?: string | string[] } | null;
  if (!body?.message) return error.message;
  return Array.isArray(body.message) ? body.message.join(' ') : body.message;
}

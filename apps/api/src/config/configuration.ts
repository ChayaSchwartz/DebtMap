import type { SecuritySource } from '@debtmap/shared';
import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Max, Min, validateSync } from 'class-validator';

/**
 * Validated at boot so a missing DATABASE_URL fails immediately with a clear
 * message, rather than surfacing as a connection error on the first request.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV: string = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:4200';

  /**
   * Without a token GitHub allows 60 requests per hour per IP, which a handful
   * of analyses exhausts. Optional so local development works without one.
   */
  @IsOptional()
  @IsString()
  GITHUB_TOKEN?: string;

  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  GEMINI_MODEL: string = 'gemini-2.5-flash-lite';

  /**
   * Deliberately configurable: memory use of the security scanners on the
   * deploy target is unverified, and this is the dial that gets turned without
   * a redeploy.
   */
  @IsInt()
  @Min(1)
  MAX_FILES: number = 5000;

  @IsInt()
  @Min(1)
  MAX_REPO_SIZE_MB: number = 1024;

  @IsInt()
  @Min(1000)
  CLONE_TIMEOUT_MS: number = 300_000;

  @IsInt()
  @Min(1)
  CHURN_WINDOW_MONTHS: number = 24;

  // --- Security scanning ---------------------------------------------------

  /**
   * Sources to run, comma separated. Configurable so an operator can drop a
   * single scanner — a host without the Semgrep binary, or a deployment with
   * no outbound network for OSV — without losing the other two or waiting for
   * a redeploy.
   */
  @IsOptional()
  @IsString()
  SECURITY_SOURCES: string = 'semgrep,gitleaks,osv';

  @IsInt()
  @Min(1000)
  SEMGREP_TIMEOUT_MS: number = 600_000;

  @IsInt()
  @Min(1000)
  GITLEAKS_TIMEOUT_MS: number = 300_000;

  @IsInt()
  @Min(1000)
  OSV_TIMEOUT_MS: number = 120_000;

  /** Comma-separated Semgrep rulesets; empty means the analyzer's defaults. */
  @IsOptional()
  @IsString()
  SEMGREP_CONFIG: string = '';

  @IsOptional()
  @IsString()
  WORKSPACE_DIR: string = '.debtmap-workspace';

  // --- AI budget -----------------------------------------------------------
  // Gemini's free tier allows 15 requests per minute and 1,000 per day on
  // Flash-Lite. The per-minute ceiling binds first, which is why explanations
  // per run are capped rather than only the daily total.

  @IsInt()
  @Min(0)
  AI_MAX_FILES_PER_RUN: number = 15;

  @IsInt()
  @Min(1)
  AI_REQUESTS_PER_MINUTE: number = 15;

  @IsInt()
  @Min(0)
  AI_DAILY_REQUEST_BUDGET: number = 900;

  @IsInt()
  @Min(0)
  DAILY_REPO_BUDGET: number = 60;
}

export function validateEnvironment(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(config, { skipMissingProperties: false });

  if (errors.length > 0) {
    const detail = errors
      .map((error) => `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return config;
}

/**
 * Unknown names are dropped rather than rejected at boot. A typo in this
 * variable should cost one scanner, not the whole service.
 */
export function parseSecuritySources(value: string): SecuritySource[] {
  const known = new Set<string>(['semgrep', 'gitleaks', 'osv']);
  return value
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter((source): source is SecuritySource => known.has(source));
}

export function parseSemgrepConfigs(value: string): string[] {
  return value
    .split(',')
    .map((config) => config.trim())
    .filter(Boolean);
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

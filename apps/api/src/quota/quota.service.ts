import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';

export type QuotaKind = 'repos' | 'gemini';

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Daily counters that keep free-tier usage inside its limits.
 *
 * These live in Redis rather than Postgres deliberately: they are ephemeral,
 * reset every day, and would otherwise add a fifth table plus a cleanup job to
 * a schema that is meant to stay small.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly limits: Record<QuotaKind, number>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.limits = {
      repos: config.get<number>('DAILY_REPO_BUDGET', 60),
      gemini: config.get<number>('AI_DAILY_REQUEST_BUDGET', 900),
    };
  }

  async peek(kind: QuotaKind): Promise<QuotaState> {
    const used = Number.parseInt((await this.redis.get(this.key(kind))) ?? '0', 10) || 0;
    return this.toState(kind, used);
  }

  /**
   * Increments and reports whether the caller is still within budget.
   *
   * The increment happens first so that concurrent callers cannot both observe
   * the last remaining slot and both proceed. A caller that is refused has
   * still consumed a count, which is the safe direction to be wrong in: it
   * under-serves rather than overspending a quota we cannot exceed.
   */
  async consume(kind: QuotaKind, amount = 1): Promise<QuotaState & { allowed: boolean }> {
    const key = this.key(kind);
    const used = await this.redis.incrby(key, amount);

    // Only set the expiry when the key is new, so a mid-day increment does not
    // extend the window and let the counter outlive its day.
    if (used === amount) {
      await this.redis.expire(key, SECONDS_IN_DAY * 2);
    }

    const state = this.toState(kind, used);
    if (used > state.limit) {
      this.logger.warn(`${kind} daily budget exhausted (${used}/${state.limit})`);
    }

    return { ...state, allowed: used <= state.limit };
  }

  /** Returns a consumed slot when the work it was reserved for never happened. */
  async refund(kind: QuotaKind, amount = 1): Promise<void> {
    await this.redis.decrby(this.key(kind), amount);
  }

  private toState(kind: QuotaKind, used: number): QuotaState {
    const limit = this.limits[kind];
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /** UTC so the reset point does not move with the server's timezone. */
  private key(kind: QuotaKind): string {
    const today = new Date().toISOString().slice(0, 10);
    return `debtmap:quota:${kind}:${today}`;
  }
}

const SECONDS_IN_DAY = 86_400;

import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';

@Controller('api/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  @Get()
  async check() {
    const [repos, gemini] = await Promise.all([
      this.quota.peek('repos'),
      this.quota.peek('gemini'),
    ]);

    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), quota: { repos, gemini } };
  }

  /**
   * Opens the database connection ahead of time.
   *
   * Neon scales to zero, so the first query after a quiet period is slow even
   * though the API itself never sleeps. Calling this a minute before a live
   * demo keeps that delay out of the demo.
   */
  @Post('warmup')
  async warmUp() {
    const started = Date.now();
    await this.prisma.warmUp();
    return { warmed: true, tookMs: Date.now() - started };
  }
}

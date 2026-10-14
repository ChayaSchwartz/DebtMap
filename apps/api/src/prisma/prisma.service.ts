import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Prisma 7 requires an explicit driver adapter; the connection string no
    // longer travels through the schema file.
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        // Neon scales to zero and drops idle connections. A small pool with a
        // short idle timeout avoids holding sockets the database has already
        // discarded, which would otherwise surface as an error on the next
        // query rather than a reconnect.
        max: 5,
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Opens a connection without doing useful work.
   *
   * Neon scales to zero, so the first query after a quiet period pays a
   * cold-start delay even though the API itself is always on. Calling this
   * before a live demo moves that delay off the critical path.
   */
  async warmUp(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.warn(`warm-up query failed: ${describeError(error)}`);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

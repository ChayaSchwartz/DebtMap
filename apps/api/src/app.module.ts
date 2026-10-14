import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalysesModule } from './analyses/analyses.module';
import { validateEnvironment } from './config/configuration';
import { GitHubModule } from './github/github.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QuotaModule } from './quota/quota.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Read from the repository root so one .env serves the API and the
      // Prisma CLI without being duplicated.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnvironment,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      }),
    }),
    PrismaModule,
    QuotaModule,
    GitHubModule,
    AnalysesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

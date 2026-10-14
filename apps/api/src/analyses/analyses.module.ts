import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { SecurityModule } from '../security/security.module';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { AnalysisProcessor } from './analysis.processor';
import { ANALYSIS_QUEUE } from './analysis.queue';

@Module({
  imports: [GitHubModule, SecurityModule, BullModule.registerQueue({ name: ANALYSIS_QUEUE })],
  controllers: [AnalysesController],
  providers: [AnalysesService, AnalysisProcessor],
  exports: [AnalysesService],
})
export class AnalysesModule {}

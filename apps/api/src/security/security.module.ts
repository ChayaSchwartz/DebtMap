import { Module } from '@nestjs/common';
import { AdvisoryCacheService } from './advisory-cache.service';

@Module({
  providers: [AdvisoryCacheService],
  exports: [AdvisoryCacheService],
})
export class SecurityModule {}

import { Global, Module } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { redisProvider, REDIS_CLIENT } from './redis.provider';

@Global()
@Module({
  providers: [redisProvider, QuotaService],
  exports: [QuotaService, REDIS_CLIENT],
})
export class QuotaModule {}

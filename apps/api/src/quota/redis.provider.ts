import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('Redis');
    const url = config.getOrThrow<string>('REDIS_URL');

    const client = new Redis(url, {
      // BullMQ requires this, and sharing one setting across both clients keeps
      // their reconnect behaviour identical.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on('error', (error: Error) => logger.error(`connection error: ${error.message}`));
    client.on('ready', () => logger.log('connected'));

    return client;
  },
};

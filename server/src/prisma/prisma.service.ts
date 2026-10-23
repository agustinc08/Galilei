import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getPrismaClientOptions } from './create-prisma-client';
import { recordSearchQuery } from './search-query-telemetry';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const profiling = process.env.BJC_SEARCH_PROFILE === 'true' && process.env.NODE_ENV !== 'production';
    super({
      ...getPrismaClientOptions(),
      ...(profiling ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}),
    });
    if (profiling) {
      (this as any).$on('query', (event: { query: string; duration: number; params?: string }) => recordSearchQuery(event.query, event.duration, event.params));
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { getPrismaClientOptions } from './create-prisma-client';
import { recordSearchQuery } from './search-query-telemetry';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const profiling =
      process.env.BJC_SEARCH_PROFILE === 'true' &&
      process.env.NODE_ENV !== 'production';
    super({
      ...getPrismaClientOptions(),
      ...(profiling
        ? { log: [{ emit: 'event' as const, level: 'query' as const }] }
        : {}),
    });
    if (profiling) {
      // Prisma only exposes the query event when the constructor's log option
      // includes it. This runtime guard configures that option in the same
      // branch, while the generated subclass type defaults to no event logs.
      const profilingClient = this as unknown as PrismaClient<'query'>;
      profilingClient.$on('query', (event) =>
        recordSearchQuery(event.query, event.duration, event.params),
      );
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

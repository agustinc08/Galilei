import { Controller, Get, Optional, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CorpusDocumentAccessService } from '../corpus/corpus-document-access.service';
import { OpenSearchRuntimeService } from '../busqueda/opensearch/opensearch-runtime.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: CorpusDocumentAccessService,
    @Optional()
    private readonly searchRuntime?: OpenSearchRuntimeService | null,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'jurisprudencia-back' };
  }

  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const result = await this.checkDependencies();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const result = await this.checkDependencies();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }

  private async checkDependencies() {
    let database: 'ok' | 'error' = 'ok';
    let storage: 'ok' | 'error' = 'ok';
    let search: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      database = 'error';
    }
    try {
      if (!(await this.documents.storageReady())) storage = 'error';
    } catch {
      storage = 'error';
    }
    try {
      if (
        this.searchRuntime
          ? !(await this.searchRuntime.isReady())
          : process.env.NODE_ENV !== 'test'
      )
        search = 'error';
    } catch {
      search = 'error';
    }
    const status =
      database === 'ok' && storage === 'ok' && search === 'ok'
        ? 'ok'
        : 'not_ready';
    return {
      status,
      service: 'jurisprudencia-back',
      checks: { api: 'ok', database, storage, search },
    };
  }
}

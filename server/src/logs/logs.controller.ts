import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { QueryLogsDto } from './dto/query-logs.dto';
import { LogsService } from './logs.service';

@ApiTags('logs')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista logs de auditoria con filtros' })
  findAll(@Query() query: QueryLogsDto) {
    return this.logsService.findAll(query);
  }

  @Get('export.csv')
  @ApiOperation({
    summary: 'Exporta hasta 5000 eventos de auditoría filtrados a CSV',
  })
  async exportCsv(@Query() query: QueryLogsDto, @Res() response: Response) {
    const csv = await this.logsService.exportCsv(query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="audit-log.csv"',
    );
    response.setHeader('Cache-Control', 'no-store');
    return response.send(`\uFEFF${csv}`);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene un log de auditoria por id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.logsService.findOne(id);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '../auth/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateReporteProblemaDto } from './dto/create-reporte-problema.dto';
import { QueryReportesProblemaDto } from './dto/query-reportes-problema.dto';
import { UpdateReporteProblemaDto } from './dto/update-reporte-problema.dto';
import { ReportesProblemasService } from './reportes-problemas.service';

const AUTHENTICATED_ROLES = [
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.LECTOR,
  ROLES.REVISOR,
  ROLES.JURISPRUDENCIA,
  ROLES.DIGESTO,
] as const;

@ApiTags('reportes-problemas')
@ApiBearerAuth()
@Roles(...AUTHENTICATED_ROLES)
@Controller('reportes-problemas')
export class ReportesProblemaController {
  constructor(private readonly service: ReportesProblemasService) {}

  @Post()
  @ApiOperation({ summary: 'Registra un problema informado por el usuario' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReporteProblemaDto,
  ) {
    return this.service.create(user.id, dto);
  }
}

@ApiTags('admin-reportes-problemas')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('admin/reportes-problemas')
export class AdminReportesProblemaController {
  constructor(private readonly service: ReportesProblemasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista y filtra los problemas reportados' })
  findAll(@Query() query: QueryReportesProblemaDto) {
    return this.service.findAll(query);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualiza estado, prioridad o seguimiento del reporte',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateReporteProblemaDto,
  ) {
    return this.service.update(id, user.id, dto);
  }
}

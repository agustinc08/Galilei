import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdminReportesProblemaController,
  ReportesProblemaController,
} from './reportes-problemas.controller';
import { ReportesProblemasService } from './reportes-problemas.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReportesProblemaController, AdminReportesProblemaController],
  providers: [ReportesProblemasService],
})
export class ReportesProblemasModule {}

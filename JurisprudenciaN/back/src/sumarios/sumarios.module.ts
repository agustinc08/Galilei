import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { SumariosController } from './sumarios.controller';
import { SumariosService } from './sumarios.service';

@Module({
  imports: [LogsModule],
  controllers: [SumariosController],
  providers: [SumariosService],
})
export class SumariosModule {}

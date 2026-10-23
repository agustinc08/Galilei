import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { CitasFalloController } from './citas-fallo.controller';
import { CitasFalloService } from './citas-fallo.service';

@Module({
  imports: [LogsModule],
  controllers: [CitasFalloController],
  providers: [CitasFalloService],
  exports: [CitasFalloService],
})
export class CitasFalloModule {}

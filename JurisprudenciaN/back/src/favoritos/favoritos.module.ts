import { Module } from '@nestjs/common';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { FavoritosController } from './favoritos.controller';
import { FavoritosService } from './favoritos.service';

@Module({
  imports: [EstadisticasModule],
  controllers: [FavoritosController],
  providers: [FavoritosService],
})
export class FavoritosModule {}

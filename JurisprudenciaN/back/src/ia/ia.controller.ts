import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { OllamaService } from './ollama.service';

@ApiTags('ia')
@Controller('ia')
export class IaController {
  constructor(private readonly ollamaService: OllamaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Verifica disponibilidad de Ollama local' })
  health() {
    return this.ollamaService.health();
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { CargaDeDatosService } from './carga-de-datos.service';

describe('CargaDeDatosService', () => {
  let service: CargaDeDatosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CargaDeDatosService],
    }).compile();

    service = module.get<CargaDeDatosService>(CargaDeDatosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

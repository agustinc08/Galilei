import { Test, TestingModule } from '@nestjs/testing';
import { DependenciaService } from './dependencia.service';

describe('DependenciaService', () => {
  let service: DependenciaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DependenciaService],
    }).compile();

    service = module.get<DependenciaService>(DependenciaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { DependenciaController } from './dependencia.controller';

describe('DependenciaController', () => {
  let controller: DependenciaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DependenciaController],
    }).compile();

    controller = module.get<DependenciaController>(DependenciaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

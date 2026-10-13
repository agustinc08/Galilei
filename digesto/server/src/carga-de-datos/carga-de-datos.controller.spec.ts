import { Test, TestingModule } from '@nestjs/testing';
import { CargaDeDatosController } from './carga-de-datos.controller';

describe('CargaDeDatosController', () => {
  let controller: CargaDeDatosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CargaDeDatosController],
    }).compile();

    controller = module.get<CargaDeDatosController>(CargaDeDatosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

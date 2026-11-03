import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES } from '../auth/constants';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  BusquedaController,
  PublicBusquedaController,
} from './busqueda.controller';

const advancedOperations: Array<keyof BusquedaController> = [
  'avanzada',
  'interpretar',
  'exportar',
  'simple',
  'sugerencias',
  'sugerenciasTemas',
  'sugerenciasMagistrados',
  'sugerenciasSalas',
  'sugerenciasTipos',
  'sugerenciasExpedientes',
  'sugerenciasCaratulas',
  'temas',
  'salas',
  'tiposFallo',
];

type Handler = (...args: never[]) => unknown;

function handlerFor(
  controller: { prototype: object },
  method: string,
): Handler {
  return Reflect.get(controller.prototype, method) as Handler;
}

function executionContext(
  handler: Handler,
  controller: object,
  roleName?: string,
) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () =>
        roleName ? { user: { rol: { nombre: roleName } } } : {},
    }),
  } as unknown as ExecutionContext;
}

describe('BETA-011 advanced jurisprudence search ACL', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it.each(advancedOperations)(
    '%s allows only the exact JURISPRUDENCIA global role',
    (operation) => {
      const handler = handlerFor(BusquedaController, operation);
      expect(
        guard.canActivate(
          executionContext(handler, BusquedaController, ROLES.JURISPRUDENCIA),
        ),
      ).toBe(true);

      for (const roleName of [
        ROLES.ADMIN,
        ROLES.OPERADOR,
        ROLES.LECTOR,
        ROLES.REVISOR,
        ROLES.DIGESTO,
        'ADMIN+JURISPRUDENCIA',
      ]) {
        expect(() =>
          guard.canActivate(
            executionContext(handler, BusquedaController, roleName),
          ),
        ).toThrow(ForbiddenException);
      }

      expect(() =>
        guard.canActivate(executionContext(handler, BusquedaController)),
      ).toThrow(ForbiddenException);
    },
  );

  it('keeps citation lookup available to Revisor', () => {
    expect(
      guard.canActivate(
        executionContext(
          handlerFor(BusquedaController, 'cita'),
          BusquedaController,
          ROLES.REVISOR,
        ),
      ),
    ).toBe(true);
  });

  it('keeps the common public search available without authentication', () => {
    const publicHandler = handlerFor(PublicBusquedaController, 'publica');
    expect(
      reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        publicHandler,
        PublicBusquedaController,
      ]),
    ).toBe(true);
    expect(
      guard.canActivate(
        executionContext(publicHandler, PublicBusquedaController),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        executionContext(
          handlerFor(PublicBusquedaController, 'sugerencias'),
          PublicBusquedaController,
        ),
      ),
    ).toBe(true);
  });
});

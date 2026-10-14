/* eslint-disable @typescript-eslint/unbound-method */
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/constants';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ArchivosController } from '../archivos/archivos.controller';
import { ArchivosService } from '../archivos/archivos.service';
import { SentenciasController } from './sentencias.controller';
import { SentenciasService } from './sentencias.service';

describe('Sprint J9 jurisprudencia workflow', () => {
  it('permits the jurisprudence editor to upload and publish but denies a reader', () => {
    const guard = new RolesGuard(new Reflector());
    const contextFor = (
      handler: ExecutionContext['getHandler'],
      role: string,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => ArchivosController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { rol: { nombre: role } } }),
        }),
      }) as unknown as ExecutionContext;

    expect(
      guard.canActivate(
        contextFor(
          ArchivosController.prototype.uploadJurisprudenciaDraft,
          'JURISPRUDENCIA',
        ),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor(SentenciasController.prototype.publicar, 'JURISPRUDENCIA'),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        contextFor(
          ArchivosController.prototype.uploadJurisprudenciaDraft,
          'LECTOR',
        ),
      ),
    ).toThrow(ForbiddenException);
    expect(
      Reflect.getMetadata(ROLES_KEY, SentenciasController.prototype.archivar),
    ).toContain('JURISPRUDENCIA');
  });

  it('forces a direct create request into draft state and strips workflow fields from metadata edits', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    const controller = new SentenciasController(
      service as unknown as SentenciasService,
      {} as unknown as import('../ia/ia.service').IaService,
    );
    const user = {
      id: 7,
    } as unknown as import('../auth/types/authenticated-user.type').AuthenticatedUser;

    await controller.create(
      {
        publicado: true,
        activo: false,
        estadoCarga: 'PUBLICADA',
        caratula: 'Caso',
      },
      user,
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        publicado: false,
        activo: true,
        estadoCarga: 'BORRADOR',
      }),
      7,
    );

    await controller.update(
      3,
      {
        publicado: true,
        activo: false,
        estadoCarga: 'PUBLICADA',
        caratula: 'Corregida',
      },
      user,
    );
    expect(service.update).toHaveBeenCalledWith(
      3,
      { caratula: 'Corregida' },
      7,
    );
  });

  it('publishes linked general Corpus files and records publication time', async () => {
    const before = { id: 3, activo: true, publicado: false };
    const updated = {
      ...before,
      publicado: true,
      publishedAt: new Date(),
      estadoCarga: 'PUBLICADA',
    };
    const tx = {
      sentencia: { update: jest.fn().mockResolvedValue(updated) },
      corpusDocumentLink: {
        findMany: jest.fn().mockResolvedValue([{ documentId: 'doc-1' }]),
      },
      corpusDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      sentencia: {
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(before),
        update: jest.fn().mockResolvedValue({
          ...updated,
          slugPublico: 'sala-h-responsabilidad-civil-2026',
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const logs = { registrarAccion: jest.fn().mockResolvedValue(undefined) };
    const service = new SentenciasService(
      prisma as unknown as import('../prisma/prisma.service').PrismaService,
      {} as unknown as import('../catalogos/catalogos.service').CatalogosService,
      {} as unknown as import('../estadisticas/eventos-consulta.service').EventosConsultaService,
      logs as unknown as import('../logs/logs.service').LogsService,
    );

    const result = await service.setPublicado(3, true, 7);

    expect(result.data.publicado).toBe(true);
    expect(tx.corpusDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['doc-1'] }, documentScope: 'GENERAL' },
        data: { visibility: 'PUBLIC' },
      }),
    );
    expect(logs.registrarAccion).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'PUBLICAR' }),
    );
  });

  it('blocks a repeated SHA before creating a second draft', async () => {
    const prisma = {
      corpusDocumentFile: {
        findFirst: jest
          .fn<Promise<unknown>, [Record<string, unknown>]>()
          .mockResolvedValue({
            documentId: 'existing-doc',
            document: { title: 'Fallo existente', links: [{ targetId: '42' }] },
          }),
      },
    };
    const service = new ArchivosService(
      prisma as unknown as import('../prisma/prisma.service').PrismaService,
      {} as unknown as import('../estadisticas/eventos-consulta.service').EventosConsultaService,
      {} as unknown as import('../logs/logs.service').LogsService,
    );
    const buffer = readFileSync(
      path.resolve(
        __dirname,
        '../../scripts/dev/fixtures/corpus/fallo-fixture.pdf',
      ),
    );
    const file = {
      size: buffer.byteLength,
      mimetype: 'application/pdf',
      originalname: 'fallo.pdf',
      buffer,
    } as Express.Multer.File;

    await expect(
      service.uploadJurisprudenciaDraft(file, 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      prisma.corpusDocumentFile.findFirst.mock.calls[0]?.[0],
    ).toMatchObject({ where: { document: { documentScope: 'GENERAL' } } });
  });
});

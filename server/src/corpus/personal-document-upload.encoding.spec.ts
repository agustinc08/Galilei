import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { PersonalDocumentController } from './personal-document.controller';
import { WorkspaceDocumentService } from './workspace-document.service';

describe('Personal folder upload multipart filename encoding', () => {
  let app: INestApplication;
  const capturedNames: string[] = [];
  const user = {
    id: 8921,
    nombre: 'QA',
    apellido: 'Encoding',
    email: 'encoding-qa@example.invalid',
    activo: true,
    rol: { id: 1, nombre: 'ADMIN' },
  } as AuthenticatedUser;

  beforeAll(async () => {
    const documents = {
      uploadPersonalFolder: jest
        .fn()
        .mockImplementation(
          (
            _user: AuthenticatedUser,
            files: Array<{ originalname: string }>,
          ) => {
            capturedNames.push(...files.map((file) => file.originalname));
            return { filenames: files.map((file) => file.originalname) };
          },
        ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PersonalDocumentController],
      providers: [
        { provide: WorkspaceDocumentService, useValue: documents },
        { provide: CorpusDocumentAccessService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (req: { user?: AuthenticatedUser }, _res: unknown, next: () => void) => {
        req.user = user;
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('preserves UTF-8 names from browser multipart headers through Multer to the service', async () => {
    const filenames = [
      'AÑO.pdf',
      'Resolución.pdf',
      'Cámara.pdf',
      'Señoría.pdf',
      'Información jurídica.pdf',
      'Pingüino.pdf',
      'ÁÉÍÓÚ Ñ ñ Ü ü (2026)_final-01.pdf',
    ];
    const server = app.getHttpServer() as Server;
    let call = request(server)
      .post('/personal/documents/folder-upload')
      .set('Accept', 'application/json');
    for (const filename of filenames) {
      call = call.attach(
        'files',
        Buffer.from('%PDF-1.4 synthetic QA fixture'),
        {
          filename,
          contentType: 'application/pdf',
        },
      );
    }

    const response = await call.expect(201);
    const responseBody = response.body as { filenames: string[] };
    expect(responseBody.filenames).toEqual(filenames);
    expect(capturedNames).toEqual(filenames);
    expect(capturedNames.some((filename) => /Ã|Â/u.test(filename))).toBe(false);
  });
});

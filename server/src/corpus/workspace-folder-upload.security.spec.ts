import { describe, expect, it, jest } from '@jest/globals';
import { WorkspaceRole } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { PrismaService } from '../prisma/prisma.service';
import type { BusquedaService } from '../busqueda/busqueda.service';
import type { CorpusDocumentAccessService } from './corpus-document-access.service';
import type { DocumentStorageAdapter } from './document-storage.adapter';
import { WorkspaceDocumentService } from './workspace-document.service';

const editor: AuthenticatedUser = {
  id: 9131,
  nombre: 'Editor QA',
  apellido: null,
  email: 'editor-workspace-folder@example.invalid',
  activo: true,
  rol: { id: 1, nombre: 'JURISPRUDENCIA', descripcion: null },
  createdAt: new Date('2026-11-03T00:00:00.000Z'),
  updatedAt: new Date('2026-11-03T00:00:00.000Z'),
};

function makeService(role: WorkspaceRole | null) {
  const findFirst = jest.fn().mockResolvedValue(role ? { role } : null);
  const createLog = jest.fn().mockResolvedValue({ id: 1 });
  const prisma = {
    workspaceMembership: { findFirst },
    accionLog: { create: createLog },
  } as unknown as PrismaService;
  const service = new WorkspaceDocumentService(
    prisma,
    {} as BusquedaService,
    {} as CorpusDocumentAccessService,
    {} as DocumentStorageAdapter,
  );
  return { service, findFirst, createLog };
}

describe('Workspace folder upload membership and path security', () => {
  it('allows a dependency Editor through membership and rejects traversal folder names', async () => {
    const { service, findFirst } = makeService(WorkspaceRole.EDITOR);

    await expect(
      service.createFolder('sala-qa', editor, { name: '..' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.createFolder('sala-qa', editor, { name: 'sub\u0000folder' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'sala-qa',
        userId: editor.id,
        active: true,
        workspace: { active: true },
      },
      select: { role: true },
    });
  });

  it('denies upload and folder creation to a dependency Viewer', async () => {
    const { service } = makeService(WorkspaceRole.VIEWER);

    await expect(service.upload('sala-qa', editor, [])).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.createFolder('sala-qa', editor, { name: 'No autorizada' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('denies a user without membership in the target dependency', async () => {
    const { service, findFirst } = makeService(null);

    await expect(
      service.upload('juzgado-qa', editor, []),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.createFolder('juzgado-qa', editor, { name: 'No accesible' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledTimes(2);
    const expectedQuery = {
      where: {
        workspaceId: 'juzgado-qa',
        userId: editor.id,
        active: true,
        workspace: { active: true },
      },
      select: { role: true },
    };
    expect(findFirst).toHaveBeenNthCalledWith(1, expectedQuery);
    expect(findFirst).toHaveBeenNthCalledWith(2, expectedQuery);
  });

  it('records a readable import summary with bounded counts and no local file paths', async () => {
    const { service, createLog } = makeService(WorkspaceRole.EDITOR);

    await expect(
      service.recordFolderUploadSummary('sala-qa', editor, {
        folderImportId: 'folder-123456789',
        rootFolderCount: 1,
        rootFolderNames: ['Expedientes 2026'],
        folderCount: 4,
        totalFiles: 3,
        eligibleFiles: 3,
        omittedFiles: 0,
        preflightErrorFiles: 0,
        attemptedFiles: 3,
        addedFiles: 1,
        duplicateFiles: 1,
        failedFiles: 1,
        notSentFiles: 0,
      }),
    ).resolves.toMatchObject({
      recorded: true,
      folderImportId: 'folder-123456789',
    });

    expect(createLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entidad: 'DocumentWorkspace',
        accion: 'FOLDER_UPLOAD_SUMMARY',
        descripcion: expect.stringContaining('3 archivos seleccionados'),
        datosDespues: expect.objectContaining({
          workspaceId: 'sala-qa',
          folderImportId: 'folder-123456789',
          addedFiles: 1,
          duplicateFiles: 1,
          failedFiles: 1,
        }),
      }),
    });
    expect(JSON.stringify(createLog.mock.calls[0])).not.toContain(
      'C:\\Users\\',
    );
  });
});

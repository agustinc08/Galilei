import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceDocumentService } from './workspace-document.service';

describe('WorkspaceDocumentService.activity', () => {
  it('includes workspace and workspace-document audit records', async () => {
    const workspaceId = 'workspace-qa';
    const rows = [
      {
        id: 7,
        accion: 'WORKSPACE_DOCUMENT_DELETE',
        descripcion: 'Documento eliminado.',
        createdAt: new Date('2026-10-30T12:00:00.000Z'),
        nombre: 'QA Admin',
        apellido: null,
      },
    ];
    const queryRaw = jest.fn().mockResolvedValue(rows);
    const prisma = {
      documentWorkspace: {
        findFirst: jest.fn().mockResolvedValue({ id: workspaceId }),
      },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new WorkspaceDocumentService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
    );
    const admin = {
      id: 1,
      rol: { nombre: 'ADMIN' },
    } as AuthenticatedUser;

    await expect(service.activity(workspaceId, admin)).resolves.toEqual(rows);

    const [template, ...parameters] = queryRaw.mock.calls[0] ?? [];
    expect(Array.from(template as TemplateStringsArray).join('?')).toContain(
      `log."entidad" IN ('DocumentWorkspace', 'WorkspaceDocument')`,
    );
    expect(parameters).toContain(workspaceId);
  });
});

import { jest } from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkspaceRole } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { WorkspaceDocumentService } from './workspace-document.service';

function makeService(
  options: {
    actorRole?: WorkspaceRole;
    targetRole?: WorkspaceRole;
    targetActive?: boolean;
    targetExists?: boolean;
    activeAdmins?: number;
  } = {},
) {
  const actorRole = options.actorRole ?? WorkspaceRole.ADMIN;
  const targetRole = options.targetRole ?? WorkspaceRole.VIEWER;
  const targetActive = options.targetActive ?? true;
  const transaction = {
    workspaceMembership: {
      upsert: jest.fn().mockResolvedValue({
        id: 'membership-2',
        userId: 2,
        role: targetRole,
        active: true,
      }),
    },
    workspaceFolderGrant: { deleteMany: jest.fn() },
  };
  const prisma = {
    documentWorkspace: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'workspace-1',
        dependency: { name: 'Sala QA' },
      }),
    },
    workspaceMembership: {
      findFirst: jest.fn().mockResolvedValue({ role: actorRole }),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.targetExists === false
            ? null
            : { role: targetRole, active: targetActive },
        ),
      count: jest.fn().mockResolvedValue(options.activeAdmins ?? 2),
    },
    usuario: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 2, nombre: 'Miembro', apellido: 'QA' }),
    },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    accionLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  const service = new WorkspaceDocumentService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const actor = {
    id: 1,
    nombre: 'Cuenta QA',
    apellido: null,
    email: 'workspace-admin@example.invalid',
    activo: true,
    rol: { id: actorRole === WorkspaceRole.ADMIN ? 1 : 2, nombre: actorRole },
  } as AuthenticatedUser;
  return { service, prisma, transaction, actor };
}

describe('WorkspaceDocumentService dependency member management', () => {
  it('blocks removing the only active administrator before writing membership or audit', async () => {
    const { service, prisma, actor } = makeService({
      targetRole: WorkspaceRole.ADMIN,
      activeAdmins: 1,
    });

    await expect(
      service.manageMember('workspace-1', actor, {
        userId: 2,
        role: WorkspaceRole.VIEWER,
        active: false,
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'El espacio debe conservar al menos un administrador activo.',
      ),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.accionLog.create).not.toHaveBeenCalled();
  });

  it('denies membership changes by a workspace editor', async () => {
    const { service, prisma, actor } = makeService({
      actorRole: WorkspaceRole.EDITOR,
      targetRole: WorkspaceRole.VIEWER,
    });

    await expect(
      service.manageMember('workspace-1', actor, {
        userId: 2,
        role: WorkspaceRole.VIEWER,
      }),
    ).rejects.toThrow(
      new ForbiddenException('Tu rol no permite esta operación.'),
    );
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.accionLog.create).not.toHaveBeenCalled();
  });

  it('allows an authorized admin to grant a membership and records an audit event', async () => {
    const { service, prisma, actor, transaction } = makeService({
      targetExists: false,
    });

    await expect(
      service.manageMember('workspace-1', actor, {
        userId: 2,
        role: WorkspaceRole.VIEWER,
      }),
    ).resolves.toMatchObject({
      userId: 2,
      role: WorkspaceRole.VIEWER,
      active: true,
    });
    expect(transaction.workspaceMembership.upsert).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'workspace-1', userId: 2 } },
      create: {
        workspaceId: 'workspace-1',
        userId: 2,
        role: WorkspaceRole.VIEWER,
        active: true,
      },
      update: { role: WorkspaceRole.VIEWER, active: true },
    });
    expect(prisma.accionLog.create).toHaveBeenCalled();
    expect(prisma.accionLog.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        usuarioId: 1,
        entidad: 'DocumentWorkspace',
        accion: 'MEMBER_UPSERT',
        descripcion: 'Miembro QA fue agregado como Consulta a Sala QA.',
        datosDespues: {
          workspaceId: 'workspace-1',
          memberUserId: 2,
          role: WorkspaceRole.VIEWER,
          active: true,
        },
      },
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import type { AuthService } from '../auth/auth.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UsuariosService } from './usuarios.service';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    nombre: 'QA Usuario',
    apellido: 'Temporal',
    email: 'qa-usuarios@example.test',
    activo: true,
    rolId: 3,
    createdAt: new Date('2026-10-30T12:00:00.000Z'),
    updatedAt: new Date('2026-10-30T12:00:00.000Z'),
    rol: { id: 3, nombre: 'LECTOR' },
    workspaceMemberships: [],
    ...overrides,
  };
}

type PrismaCall = {
  select?: Record<string, unknown>;
  data?: Record<string, unknown>;
  where?: Record<string, unknown>;
};

describe('UsuariosService', () => {
  const findUnique = jest.fn<(args: PrismaCall) => Promise<unknown>>();
  let lastFindManyArgs: PrismaCall | undefined;
  let lastCreateArgs: PrismaCall | undefined;
  let auditEntries: Array<{ accion: string; [key: string]: unknown }> = [];
  const findMany = jest.fn<(args: PrismaCall) => Promise<unknown[]>>();
  const create = jest.fn<(args: PrismaCall) => Promise<unknown>>();
  const update = jest.fn<(args: PrismaCall) => Promise<unknown>>();
  const count = jest.fn<(args: PrismaCall) => Promise<number>>();
  const hashContraseña = jest.fn<(password: string) => Promise<string>>();
  const registrarAccion = jest.fn(
    (entry: { accion: string; [key: string]: unknown }) => {
      auditEntries.push(entry);
      return Promise.resolve();
    },
  );
  let service: UsuariosService;

  beforeEach(() => {
    jest.clearAllMocks();
    lastFindManyArgs = undefined;
    lastCreateArgs = undefined;
    auditEntries = [];
    const prisma = {
      usuario: { findUnique, findMany, create, update, count },
      accionLog: { findMany },
    } as unknown as PrismaService;
    service = new UsuariosService(
      prisma,
      { hashContraseña } as unknown as AuthService,
      { registrarAccion } as unknown as LogsService,
    );
    hashContraseña.mockResolvedValue('hashed-password');
    count.mockResolvedValue(2);
  });

  it('lists safe user projections without requesting the password hash', async () => {
    findMany.mockImplementation((args: PrismaCall) => {
      lastFindManyArgs = args;
      return Promise.resolve([user()]);
    });

    await expect(service.findAll()).resolves.toEqual({ data: [user()] });

    expect(lastFindManyArgs?.select?.passwordHash).toBeUndefined();
    expect(lastFindManyArgs?.select?.workspaceMemberships).toBeDefined();
  });

  it('creates through the official password hasher and audits only safe identity data', async () => {
    const created = user();
    create.mockImplementation((args: PrismaCall) => {
      lastCreateArgs = args;
      return Promise.resolve(created);
    });
    const dto = {
      nombre: 'QA Usuario',
      apellido: 'Temporal',
      email: 'qa-usuarios@example.test',
      password: 'qa-only-secret',
      rolId: 3,
      activo: true,
    } satisfies CreateUsuarioDto;

    await expect(service.create(dto, 1)).resolves.toEqual({ data: created });

    expect(hashContraseña).toHaveBeenCalledWith('qa-only-secret');
    expect(lastCreateArgs?.data?.passwordHash).toBe('hashed-password');
    expect(JSON.stringify(auditEntries)).not.toContain('qa-only-secret');
    expect(JSON.stringify(auditEntries)).not.toContain('passwordHash');
  });

  it('audits role and activation changes without secrets', async () => {
    const before = user();
    const after = user({
      activo: false,
      rolId: 4,
      rol: { id: 4, nombre: 'REVISOR' },
    });
    findUnique.mockResolvedValue(before);
    update.mockResolvedValue(after);

    await service.update(7, { activo: false, rolId: 4 }, 1);

    expect(auditEntries).toHaveLength(2);
    expect(auditEntries.map((entry) => entry.accion)).toEqual([
      'USER_DEACTIVATE',
      'USER_ROLE_CHANGE',
    ]);
    expect(JSON.stringify(auditEntries)).not.toContain('passwordHash');
  });

  it('protects the last active administrator and prevents self-deactivation', async () => {
    findUnique.mockResolvedValue(
      user({ rolId: 1, rol: { id: 1, nombre: 'ADMIN' } }),
    );
    count.mockResolvedValue(1);

    await expect(
      service.update(7, { activo: false }, 3),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();

    await expect(
      service.update(7, { activo: false }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

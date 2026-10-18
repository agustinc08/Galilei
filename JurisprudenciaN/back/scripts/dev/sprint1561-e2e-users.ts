import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  const root = path.resolve(process.cwd(), '../../_recovery-work/sprint1561');
  const manifestPath = path.join(root, 'e2e-users.json');
  await mkdir(root, { recursive: true });
  const role = await prisma.rol.findUniqueOrThrow({
    where: { nombre: 'LECTOR' },
    select: { id: true },
  });
  const runId =
    `${Date.now()}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
  const users = await prisma.$transaction(
    Array.from({ length: 3 }, (_, index) =>
      prisma.usuario.create({
        data: {
          nombre: `Sprint 15.6.1 persona ${String(index + 1).padStart(2, '0')}`,
          email: `sprint1561-e2e-${runId}-${String(index + 1).padStart(2, '0')}@example.invalid`,
          passwordHash: 'synthetic-only-not-a-login-credential',
          rolId: role.id,
        },
        select: { id: true, nombre: true, email: true },
      }),
    ),
  );
  const manifest = { runId, users };
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `SPRINT1561_E2E_USERS=${JSON.stringify({ count: users.length, manifestPath })}`,
  );
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'SPRINT1561_E2E_USERS_FAILED',
  );
  process.exitCode = 1;
});

import { randomBytes } from 'node:crypto';
import { hash as bcryptHash } from 'bcrypt';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

const workspaceRoot = path.resolve(process.cwd(), '..');
const credentialPath = path.join(workspaceRoot, '_recovery-work', 'sprint10', 'acceptance', 'credentials.json');
const accounts = [
  { key: 'admin', role: 'ADMIN', name: 'Sprint 10 Admin', email: 'sprint10.admin@example.invalid', description: 'Cuenta sintética temporal para pruebas locales de administración.' },
  { key: 'operator', role: 'OPERADOR', name: 'Sprint 10 Operador', email: 'sprint10.operator@example.invalid', description: 'Cuenta sintética temporal de compatibilidad de operador.' },
  { key: 'reader', role: 'LECTOR', name: 'Sprint 10 Lector', email: 'sprint10.reader@example.invalid', description: 'Lectura y búsqueda interna sin curaduría.' },
  { key: 'reviewer', role: 'REVISOR', name: 'Sprint 10 Revisor', email: 'sprint10.reviewer@example.invalid', description: 'Revisión de asociaciones y clasificaciones.' },
  { key: 'jurisprudencia', role: 'JURISPRUDENCIA', name: 'Sprint 10 Jurisprudencia', email: 'sprint10.jurisprudencia@example.invalid', description: 'Curaduría editorial y mantenimiento de sumarios.' },
  { key: 'digesto', role: 'DIGESTO', name: 'Sprint 10 Digesto', email: 'sprint10.digesto@example.invalid', description: 'Taxonomía y memberships Digesto.' },
] as const;

type SavedCredentials = { generatedAt: string; localOnly: true; accounts: Record<string, { email: string; password: string }> };

async function main() {
  assertDevTarget();
  await mkdir(path.dirname(credentialPath), { recursive: true });
  let saved = await readFile(credentialPath, 'utf8').then((raw) => JSON.parse(raw) as SavedCredentials).catch(() => null);
  if (!saved || !saved.localOnly || accounts.some((account) => !saved?.accounts[account.key]?.password)) {
    saved = {
      generatedAt: new Date().toISOString(),
      localOnly: true,
      accounts: Object.fromEntries(accounts.map((account) => [account.key, { email: account.email, password: randomBytes(32).toString('base64url') }])),
    };
    await writeFile(credentialPath, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  }

  const prisma = new PrismaService();
  const created: string[] = [];
  try {
    await prisma.$connect();
    for (const account of accounts) {
      const role = await prisma.rol.upsert({
        where: { nombre: account.role },
        create: { nombre: account.role, descripcion: account.description },
        update: { descripcion: account.description },
      });
      const existing = await prisma.usuario.findUnique({ where: { email: account.email }, select: { id: true } });
      const passwordHash = await bcryptHash(saved.accounts[account.key].password, 10);
      await prisma.usuario.upsert({
        where: { email: account.email },
        create: { nombre: account.name, email: account.email, passwordHash, activo: true, rolId: role.id },
        update: { nombre: account.name, apellido: null, passwordHash, activo: true, rolId: role.id },
      });
      if (!existing) created.push(account.key);
    }
    console.log(JSON.stringify({ status: 'SPRINT10_ACCEPTANCE_SEED_PASS', accounts: accounts.map(({ key, role, email }) => ({ key, role, email })), created, credentialsPath: credentialPath, database: '127.0.0.1:55432/buscador_juridico_civil_dev', passwordsPrinted: false }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function assertDevTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SPRINT10_ACCEPTANCE_SEED_FAILED');
  process.exitCode = 1;
});

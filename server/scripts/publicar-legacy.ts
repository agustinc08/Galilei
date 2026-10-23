import 'dotenv/config';

import { createPrismaClient } from '../src/importacion/utils/prisma-client';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const prisma = createPrismaClient();

  try {
    const [
      totalSentenciasLegacy,
      sentenciasPublicas,
      sentenciasAActualizar,
      totalSumariosLegacy,
      sumariosPublicos,
      sumariosAActualizar,
    ] = await Promise.all([
      prisma.sentencia.count({ where: { legacyId: { not: null } } }),
      prisma.sentencia.count({
        where: { legacyId: { not: null }, publicado: true, activo: true },
      }),
      prisma.sentencia.count({
        where: {
          legacyId: { not: null },
          OR: [
            { publicado: false },
            { activo: false },
            { estadoCarga: { not: 'PUBLICADA' } },
          ],
        },
      }),
      prisma.sumario.count({ where: { legacyId: { not: null } } }),
      prisma.sumario.count({
        where: { legacyId: { not: null }, publicado: true, activo: true },
      }),
      prisma.sumario.count({
        where: {
          legacyId: { not: null },
          OR: [{ publicado: false }, { activo: false }],
        },
      }),
    ]);

    console.log(dryRun ? 'Dry-run publicación legacy' : 'Publicación legacy');
    console.log(`Sentencias legacy totales: ${totalSentenciasLegacy}`);
    console.log(`Sentencias legacy activas/publicadas: ${sentenciasPublicas}`);
    console.log(`Sentencias legacy a actualizar: ${sentenciasAActualizar}`);
    console.log(`Sumarios legacy totales: ${totalSumariosLegacy}`);
    console.log(`Sumarios legacy activos/publicados: ${sumariosPublicos}`);
    console.log(`Sumarios legacy a actualizar: ${sumariosAActualizar}`);

    if (dryRun) {
      return;
    }

    const [sentenciasUpdate, sumariosUpdate] = await Promise.all([
      prisma.sentencia.updateMany({
        where: {
          legacyId: { not: null },
          OR: [
            { publicado: false },
            { activo: false },
            { estadoCarga: { not: 'PUBLICADA' } },
          ],
        },
        data: {
          publicado: true,
          activo: true,
          estadoCarga: 'PUBLICADA',
        },
      }),
      prisma.sumario.updateMany({
        where: {
          legacyId: { not: null },
          OR: [{ publicado: false }, { activo: false }],
        },
        data: {
          publicado: true,
          activo: true,
        },
      }),
    ]);

    console.log(`Sentencias legacy actualizadas: ${sentenciasUpdate.count}`);
    console.log(`Sumarios legacy actualizados: ${sumariosUpdate.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

const prisma = createPrismaClient();

const SALAS = [
  'Sala A',
  'Sala B',
  'Sala C',
  'Sala D',
  'Sala E',
  'Sala F',
  'Sala G',
  'Sala H',
  'Sala I',
  'Sala J',
  'Sala K',
  'Sala L',
  'Sala M',
];

const TRIBUNALES_ORIGEN = Array.from(
  { length: 110 },
  (_, index) => `Juzgado ${index + 1}`,
);

const TIPOS_FALLO = [
  { nombre: 'Libre', codigo: 'LIBRE' },
  { nombre: 'Relaci\u00f3n', codigo: 'RELACION' },
];

async function main() {
  const adminRol = await prisma.rol.upsert({
    where: { nombre: 'ADMIN' },
    update: { descripcion: 'Administradores del sistema' },
    create: {
      nombre: 'ADMIN',
      descripcion: 'Administradores del sistema',
    },
  });

  const operadorRol = await prisma.rol.upsert({
    where: { nombre: 'OPERADOR' },
    update: { descripcion: 'Operadores de carga y consulta' },
    create: {
      nombre: 'OPERADOR',
      descripcion: 'Operadores de carga y consulta',
    },
  });

  await prisma.usuario.upsert({
    where: { email: 'admin@jurisprudencia.local' },
    update: {
      nombre: 'Admin',
      apellido: null,
      passwordHash: await bcrypt.hash('Admin12345', 10),
      activo: true,
      rolId: adminRol.id,
    },
    create: {
      nombre: 'Admin',
      apellido: null,
      email: 'admin@jurisprudencia.local',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      activo: true,
      rolId: adminRol.id,
    },
  });

  await prisma.usuario.upsert({
    where: { email: 'operador@jurisprudencia.local' },
    update: {
      nombre: 'Operador',
      apellido: null,
      passwordHash: await bcrypt.hash('Operador12345', 10),
      activo: true,
      rolId: operadorRol.id,
    },
    create: {
      nombre: 'Operador',
      apellido: null,
      email: 'operador@jurisprudencia.local',
      passwordHash: await bcrypt.hash('Operador12345', 10),
      activo: true,
      rolId: operadorRol.id,
    },
  });

  let salasCreadas = 0;
  let salasActualizadas = 0;
  let tiposCreados = 0;
  let tiposActualizados = 0;
  let tribunalesCreados = 0;
  let tribunalesActualizados = 0;

  for (const [index, nombre] of SALAS.entries()) {
    const codigo = nombre.replace('Sala ', '');
    const existente = await prisma.sala.findFirst({
      where: {
        OR: [{ codigo }, { nombre }],
      },
    });

    if (existente) {
      await prisma.sala.update({
        where: { id: existente.id },
        data: {
          nombre,
          codigo,
          activa: true,
          orden: index + 1,
        },
      });
      salasActualizadas += 1;
      continue;
    }

    await prisma.sala.create({
      data: {
        nombre,
        codigo,
        activa: true,
        orden: index + 1,
      },
    });
    salasCreadas += 1;
  }

  for (const [index, item] of TIPOS_FALLO.entries()) {
    const existente = await prisma.tipoFallo.findFirst({
      where: {
        OR: [{ codigo: item.codigo }, { nombre: item.nombre }],
      },
    });

    if (existente) {
      await prisma.tipoFallo.update({
        where: { id: existente.id },
        data: {
          nombre: item.nombre,
          codigo: item.codigo,
          activo: true,
          orden: index + 1,
        },
      });
      tiposActualizados += 1;
      continue;
    }

    await prisma.tipoFallo.create({
      data: {
        nombre: item.nombre,
        codigo: item.codigo,
        activo: true,
        orden: index + 1,
      },
    });
    tiposCreados += 1;
  }

  for (const [index, nombre] of TRIBUNALES_ORIGEN.entries()) {
    const codigo = String(index + 1);
    const existente = await prisma.tribunalOrigen.findFirst({
      where: {
        OR: [{ codigo }, { nombre }],
      },
    });

    if (existente) {
      await prisma.tribunalOrigen.update({
        where: { id: existente.id },
        data: {
          nombre,
          codigo,
          activo: true,
          orden: index + 1,
        },
      });
      tribunalesActualizados += 1;
      continue;
    }

    await prisma.tribunalOrigen.create({
      data: {
        nombre,
        codigo,
        activo: true,
        orden: index + 1,
      },
    });
    tribunalesCreados += 1;
  }

  console.log(
    [
      'Seed minima finalizada.',
      `Salas creadas: ${salasCreadas}. Salas actualizadas: ${salasActualizadas}.`,
      `Tipos de fallo creados: ${tiposCreados}. Tipos de fallo actualizados: ${tiposActualizados}.`,
      `Tribunales creados: ${tribunalesCreados}. Tribunales actualizados: ${tribunalesActualizados}.`,
      'Usuarios seed OK: admin@jurisprudencia.local, operador@jurisprudencia.local.',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

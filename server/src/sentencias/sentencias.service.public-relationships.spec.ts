import type { CatalogosService } from '../catalogos/catalogos.service';
import type { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

function makeServiceWithPublicSentence() {
  const privateTarget = {
    id: 19,
    publicado: false,
    activo: true,
    numeroSentencia: '19/2020',
    expediente: 'CIV 19/2020',
    sala: 'C',
    fecha: new Date('2020-01-01T00:00:00.000Z'),
    slugPublico: 'private-target',
  };
  const publicTarget = {
    ...privateTarget,
    id: 20,
    publicado: true,
    slugPublico: 'public-target',
  };
  const sentence = {
    id: 7,
    slugPublico: 'source',
    publicado: true,
    activo: true,
    numeroSentencia: '7/2024',
    tipoFallo: 'Sentencia',
    sala: 'C',
    fecha: new Date('2024-06-03T00:00:00.000Z'),
    expediente: 'CIV 7/2024',
    tribunalOrigen: 'Cámara Civil',
    caratula: 'Actora c/ demandada',
    actor: 'Actora',
    demandado: 'Demandada',
    anonimizado: false,
    actorPublico: null,
    demandadoPublico: null,
    objeto: null,
    magistrados: null,
    juez: null,
    resumenPublicado: false,
    resumenIa: null,
    resenaPublicada: false,
    resena: null,
    citaPersonalizada: null,
    citasFallo: [],
    referenciasNormativas: [],
    referenciasJurisprudenciales: [
      {
        id: 1,
        sentenciaId: 7,
        referencia: 'Referencia privada',
        falloRelacionadoId: privateTarget.id,
        textoOriginal: 'Referencia privada',
        createdAt: new Date('2024-07-01T00:00:00.000Z'),
        falloRelacionado: privateTarget,
      },
      {
        id: 2,
        sentenciaId: 7,
        referencia: 'Referencia pública',
        falloRelacionadoId: publicTarget.id,
        textoOriginal: 'Referencia pública',
        createdAt: new Date('2024-07-02T00:00:00.000Z'),
        falloRelacionado: publicTarget,
      },
    ],
    referenciasDoctrinarias: [],
    sumarios: [],
    archivosPdf: [],
  };
  const prisma = {
    sentencia: { findFirst: jest.fn().mockResolvedValue(sentence) },
  };
  const service = new SentenciasService(
    prisma as unknown as PrismaService,
    {} as CatalogosService,
    { trackSafe: jest.fn() } as unknown as EventosConsultaService,
    {} as LogsService,
  );
  return { service, prisma };
}

describe('public curatorial judgment relationships', () => {
  it.each(['getPublicBySlug', 'getPublicFichaBySlug'] as const)(
    '%s omits unpublished target identifiers and lifecycle fields',
    async (method) => {
      const { service, prisma } = makeServiceWithPublicSentence();
      const result = await service[method]('source');
      const references = result.data.referenciasJurisprudenciales as Array<{
        falloRelacionadoId: number | null;
        falloRelacionado: Record<string, unknown> | null;
      }>;

      const findFirstCalls = prisma.sentencia.findFirst.mock
        .calls as unknown as Array<
        [{ where: { publicado: boolean; activo: boolean } }]
      >;
      expect(findFirstCalls[0]?.[0].where).toMatchObject({
        publicado: true,
        activo: true,
      });
      expect(references[0]).toMatchObject({
        falloRelacionadoId: null,
        falloRelacionado: null,
      });
      expect(references[1]).toMatchObject({
        falloRelacionadoId: 20,
        falloRelacionado: { id: 20, slugPublico: 'public-target' },
      });
      expect(references[1]?.falloRelacionado).not.toHaveProperty('publicado');
      expect(references[1]?.falloRelacionado).not.toHaveProperty('activo');
    },
  );
});

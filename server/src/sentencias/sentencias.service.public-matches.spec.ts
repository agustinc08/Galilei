import { BadRequestException, NotFoundException } from '@nestjs/common';
import path from 'node:path';
import type { CatalogosService } from '../catalogos/catalogos.service';
import type { EventosConsultaService } from '../estadisticas/eventos-consulta.service';
import type { LogsService } from '../logs/logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SentenciasService } from './sentencias.service';

const fixtureRoot = path.resolve(process.cwd(), 'scripts/dev/fixtures/corpus');
const fixturePdfPath = path.join(fixtureRoot, 'fallo-fixture.pdf');
const previousStoragePath = process.env.BJC_CORPUS_STORAGE_PATH;

function makeService() {
  const prisma = {
    sentencia: { findFirst: jest.fn() },
    corpusDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new SentenciasService(
    prisma as unknown as PrismaService,
    {} as CatalogosService,
    {} as EventosConsultaService,
    {} as LogsService,
  );
  return { service, prisma };
}

function linkedSource(
  pages: Array<{
    pageNumber: number;
    text: string;
    textKind: 'NATIVE' | 'OCR';
    processingStatus?: string;
  }>,
  status = 'TEXT_EXTRACTED',
) {
  return [
    {
      document: {
        documentScope: 'GENERAL',
        latestExtraction: {
          id: 'synthetic-extraction',
          status,
          extractor: 'synthetic-test',
          extractorVersion: '1',
          extractedAt: new Date(),
          file: {
            sha256: 'a'.repeat(64),
            storageKey: 'fallo-fixture.pdf',
            pageCount: 9,
          },
          pages: pages.map((page) => ({
            ...page,
            processingStatus:
              page.processingStatus ??
              (page.textKind === 'NATIVE' ? 'TEXT_NATIVE' : 'OCR_PENDING'),
          })),
        },
      },
    },
  ];
}

describe('SentenciasService.getPublicMatchesBySlug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BJC_CORPUS_STORAGE_PATH = fixtureRoot;
  });
  afterAll(() => {
    if (previousStoragePath === undefined)
      delete process.env.BJC_CORPUS_STORAGE_PATH;
    else process.env.BJC_CORPUS_STORAGE_PATH = previousStoragePath;
  });

  it('returns exact physical PDF pages and source excerpts from the linked public extraction', async () => {
    const { service, prisma } = makeService();
    const sentence = {
      id: 42,
      archivosPdf: [{ id: 9, rutaArchivo: fixturePdfPath }],
    };
    prisma.sentencia.findFirst.mockResolvedValue(sentence);
    prisma.corpusDocumentLink.findMany.mockResolvedValue(
      linkedSource(
        [
          {
            pageNumber: 2,
            text: 'Una reparación adecuada no resuelve esta cuestión.',
            textKind: 'NATIVE',
          },
          {
            pageNumber: 7,
            text: 'La responsabilidad civil deriva del accidente probado.',
            textKind: 'NATIVE',
          },
          {
            pageNumber: 9,
            text: 'La responsabilidad civil también requiere causalidad.',
            textKind: 'OCR',
            processingStatus: 'OCR_HUMAN_APPROVED',
          },
        ],
        'OCR_HUMAN_APPROVED',
      ),
    );

    const response = await service.getPublicMatchesBySlug(
      'fallo-publicado',
      'responsabilidad civil',
    );

    expect(prisma.sentencia.findFirst).toHaveBeenCalledWith({
      where: {
        publicado: true,
        activo: true,
        OR: [{ slugPublico: 'fallo-publicado' }],
      },
      select: {
        id: true,
        archivosPdf: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, rutaArchivo: true },
        },
      },
    });
    expect(prisma.corpusDocumentLink.findMany).toHaveBeenCalled();
    expect(response.data.status).toBe('MATCHES');
    expect(response.data.matches).toEqual([
      expect.objectContaining({ pageNumber: 7 }),
      expect.objectContaining({ pageNumber: 7 }),
      expect.objectContaining({ pageNumber: 9 }),
      expect.objectContaining({ pageNumber: 9 }),
    ]);
    expect(response.data.matches[0]?.context).toContain('responsabilidad');
    expect(response.data.matches[0]).toMatchObject({
      pageNumber: 7,
      textKind: 'NATIVE',
    });
    expect(response.data.matches[2]).toMatchObject({
      pageNumber: 9,
      textKind: 'OCR',
    });
    expect(response.data).not.toHaveProperty('sourceChecksum');
  });

  it('reports no searchable text without inventing a page', async () => {
    const { service, prisma } = makeService();
    prisma.sentencia.findFirst.mockResolvedValue({
      id: 42,
      archivosPdf: [],
    });

    await expect(
      service.getPublicMatchesBySlug('fallo-publicado', 'daño'),
    ).resolves.toEqual({
      data: {
        status: 'NO_TEXT',
        total: 0,
        returned: 0,
        exactTotalKnown: true,
        truncated: false,
        matches: [],
      },
    });
  });

  it('reports no match when the linked source has text but no exact occurrence', async () => {
    const { service, prisma } = makeService();
    prisma.sentencia.findFirst.mockResolvedValue({
      id: 42,
      archivosPdf: [{ id: 9, rutaArchivo: fixturePdfPath }],
    });
    prisma.corpusDocumentLink.findMany.mockResolvedValue(
      linkedSource([
        {
          pageNumber: 1,
          text: 'Texto disponible, sin coincidencia.',
          textKind: 'NATIVE',
        },
      ]),
    );

    const response = await service.getPublicMatchesBySlug(
      'fallo-publicado',
      'prescripción',
    );
    expect(response.data).toMatchObject({
      status: 'NO_MATCH',
      total: 0,
      returned: 0,
      matches: [],
    });
  });

  it('does not expose matches for an unpublished or inactive sentence', async () => {
    const { service, prisma } = makeService();
    prisma.sentencia.findFirst.mockResolvedValue(null);

    await expect(
      service.getPublicMatchesBySlug('no-publicado', 'daño'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.corpusDocumentLink.findMany).not.toHaveBeenCalled();
  });

  it('uses the shared query parser limits for malformed or oversized queries', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.getPublicMatchesBySlug('fallo-publicado', 'x'.repeat(301)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sentencia.findFirst).not.toHaveBeenCalled();
    expect(prisma.corpusDocumentLink.findMany).not.toHaveBeenCalled();
  });
});

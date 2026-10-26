import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { ResearchRelationshipsService } from './research-relationships.service';

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    sentencia: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    sentenciaRelationshipCandidate: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    corpusDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return {
    service: new ResearchRelationshipsService(
      prisma as unknown as PrismaService,
    ),
    prisma,
  };
}

describe('ResearchRelationshipsService', () => {
  it('extracts idempotent review candidates from explicit references, without auto-verifying them', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentencia.findUnique.mockResolvedValue({
      id: 1,
      expediente: 'CIV 1234/2020',
      numeroSentencia: '88/2022',
      referenciasJurisprudenciales: [
        {
          referencia:
            'Expte. CIV 1234/2020; Expte. 987/2021; Sentencia 88/2022',
          textoOriginal: null,
          falloRelacionadoId: null,
        },
      ],
      citasFallo: [],
    });
    prisma.sentencia.findMany.mockResolvedValue([{ id: 2 }]);
    prisma.sentenciaRelationshipCandidate.createMany.mockResolvedValue({
      count: 1,
    });
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([
      { id: 4, status: 'DETECTED_CANDIDATE' },
    ]);

    const result = await service.extractForSentence(1);

    expect(result.data.created).toBe(1);
    expect(
      prisma.sentenciaRelationshipCandidate.createMany,
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceSentenceId: 1,
          targetSentenceId: 2,
          normalizedIdentifier: '987/2021',
          status: 'DETECTED_CANDIDATE',
          confidence: null,
          page: null,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('requires a published target before a candidate can be verified', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentenciaRelationshipCandidate.findFirst.mockResolvedValue({
      id: 4,
      sourceSentenceId: 1,
      targetSentenceId: null,
    });

    await expect(
      service.reviewCandidate(4, 7, { status: 'VERIFIED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      prisma.sentenciaRelationshipCandidate.updateMany,
    ).not.toHaveBeenCalled();

    prisma.sentencia.findFirst.mockResolvedValue(null);
    await expect(
      service.reviewCandidate(4, 7, {
        status: 'VERIFIED',
        targetSentenceId: 2,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sentencia.findFirst).toHaveBeenCalledWith({
      where: { id: 2, publicado: true, activo: true },
      select: { id: true },
    });
  });

  it('stores page and parser provenance for exact-source v2 candidates without verifying them', async () => {
    const { service, prisma } = serviceWith();
    const root = mkdtempSync(path.join(tmpdir(), 'galilei-sprint3-'));
    const storageKey = 'ab/source.pdf';
    const pdfPath = path.join(root, storageKey);
    mkdirSync(path.dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, '%PDF-1.7 synthetic QA');
    const previousStorage = process.env.BJC_CORPUS_STORAGE_PATH;
    process.env.BJC_CORPUS_STORAGE_PATH = root;
    try {
      prisma.sentencia.findUnique.mockResolvedValue({
        id: 1,
        expediente: '1/2020',
        numeroSentencia: null,
        archivosPdf: [{ id: 10, rutaArchivo: pdfPath }],
        referenciasJurisprudenciales: [],
        citasFallo: [],
      });
      prisma.corpusDocumentLink.findMany.mockResolvedValue([
        {
          document: {
            documentScope: 'GENERAL',
            latestExtraction: {
              id: 'extract-1',
              status: 'TEXT_EXTRACTED',
              extractor: 'pdf-parse',
              extractorVersion: 'v1',
              extractedAt: new Date('2026-10-25T00:00:00.000Z'),
              file: { sha256: 'a'.repeat(64), storageKey, pageCount: 1 },
              pages: [
                {
                  pageNumber: 1,
                  text: 'Expte. 987/2021',
                  textKind: 'NATIVE',
                  processingStatus: 'TEXT_NATIVE',
                },
              ],
            },
          },
        },
      ]);
      prisma.sentencia.findMany.mockResolvedValue([
        {
          id: 2,
          expediente: '987/2021',
          numeroSentencia: null,
          sala: 'E',
          fecha: null,
          publicado: true,
          activo: true,
        },
      ]);
      prisma.sentenciaRelationshipCandidate.createMany.mockResolvedValue({
        count: 1,
      });
      prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

      const result = await service.extractForSentence(1);

      expect(result.data.created).toBe(1);
      expect(
        prisma.sentenciaRelationshipCandidate.createMany,
      ).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            rawCitation: 'Expte. 987/2021',
            sourceExtractionId: 'extract-1',
            sourceChecksum: 'a'.repeat(64),
            sourcePage: 1,
            sourceStartOffset: 0,
            sourceEndOffset: 15,
            citationFamily: 'EXPEDIENTE_IDENTIFIER',
            resolutionOutcome: 'RESOLVED_UNIQUE',
            targetSentenceId: 2,
            status: 'DETECTED_CANDIDATE',
            parserVersion: 'argentine-citation-parser-v2',
          }),
        ],
        skipDuplicates: true,
      });
    } finally {
      if (previousStorage === undefined)
        delete process.env.BJC_CORPUS_STORAGE_PATH;
      else process.env.BJC_CORPUS_STORAGE_PATH = previousStorage;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires both ends of a public relationship to be published and active', async () => {
    const { service, prisma } = serviceWith();
    prisma.sentencia.findFirst.mockResolvedValue({ id: 10 });
    prisma.sentenciaRelationshipCandidate.findMany.mockResolvedValue([]);

    await service.findPublicVerifiedRelationships('public-slug');

    const call = prisma.sentenciaRelationshipCandidate.findMany.mock
      .calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(call[0].where).toMatchObject({
      status: 'VERIFIED',
      sourceSentence: { is: { publicado: true, activo: true } },
      targetSentence: { is: { publicado: true, activo: true } },
    });
  });
});

import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { resolve as resolvePath } from 'node:path';
import { Prisma } from '../generated/prisma/client';
import { obtenerPdfsReales } from '../archivos/pdf-real.util';
import { LocalDocumentStorageAdapter } from '../corpus/document-storage.adapter';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionItemsQueryDto } from './dto/collection-items-query.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { UpdateCollectionNoteDto } from './dto/update-collection-note.dto';
import {
  buildResearchBundle,
  createResearchBundleZip,
  type ResearchTextSourceProvenance,
} from './research-bundle.util';

const MAX_BUNDLE_JUDGMENTS = 1000;

const PUBLIC_SENTENCE_SELECT = {
  id: true,
  slugPublico: true,
  caratula: true,
  numeroSentencia: true,
  expediente: true,
  sala: true,
  fecha: true,
  tipoFallo: true,
} as const;

function normalizedName(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('es-AR');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ResearchCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async exportBundle(usuarioId: number, id: number) {
    const collection = await this.prisma.researchCollection.findFirst({
      where: { id, usuarioId },
      select: { id: true, nombre: true, createdAt: true, updatedAt: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');

    const totalItemCount = await this.prisma.researchCollectionItem.count({
      where: { collectionId: id },
    });
    if (totalItemCount > MAX_BUNDLE_JUDGMENTS) {
      throw new PayloadTooLargeException(
        `El dossier supera el límite seguro de ${MAX_BUNDLE_JUDGMENTS} fallos.`,
      );
    }

    // Recheck the public ACL at export time. Notes are private to this owner's
    // collection item, and only accessible public judgment metadata is selected.
    const items = await this.prisma.researchCollectionItem.findMany({
      where: {
        collectionId: id,
        sentencia: { is: { publicado: true, activo: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        nota: true,
        createdAt: true,
        sentencia: {
          select: {
            id: true,
            slugPublico: true,
            caratula: true,
            numeroSentencia: true,
            expediente: true,
            sala: true,
            fecha: true,
            tipoFallo: true,
            archivosPdf: {
              orderBy: { createdAt: 'desc' },
              select: { id: true, rutaArchivo: true },
            },
          },
        },
      },
    });
    const sentencePaths = new Map(
      items.map(({ sentencia }) => [
        String(sentencia.id),
        obtenerPdfsReales(sentencia.archivosPdf).map((file) =>
          resolvePath(file.rutaArchivo),
        ),
      ]),
    );
    const storage = new LocalDocumentStorageAdapter();
    const sourceLinks = items.length
      ? await this.prisma.corpusDocumentLink.findMany({
          where: {
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            relationship: 'ASSOCIATED_WITH',
            targetId: {
              in: items.map(({ sentencia }) => String(sentencia.id)),
            },
            document: { is: { documentScope: 'GENERAL' } },
          },
          select: {
            targetId: true,
            document: {
              select: {
                documentScope: true,
                latestExtraction: {
                  select: {
                    status: true,
                    extractorVersion: true,
                    file: { select: { sha256: true, storageKey: true } },
                    pages: {
                      orderBy: { pageNumber: 'asc' },
                      select: {
                        pageNumber: true,
                        textKind: true,
                        processingStatus: true,
                      },
                    },
                    ocrReviewApproval: {
                      select: {
                        searchTextChecksum: true,
                        run: {
                          select: {
                            pages: {
                              select: {
                                pageNumber: true,
                                status: true,
                                approvedChecksum: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];
    const provenanceBySentence = new Map<
      string,
      ResearchTextSourceProvenance
    >();
    const sourcesBySentence = new Map<
      string,
      Map<string, ResearchTextSourceProvenance>
    >();
    for (const link of sourceLinks) {
      const extraction = link.document.latestExtraction;
      if (
        link.document.documentScope !== 'GENERAL' ||
        !extraction ||
        !['TEXT_EXTRACTED', 'OCR_HUMAN_APPROVED'].includes(extraction.status) ||
        !sentencePaths
          .get(link.targetId)
          ?.includes(resolvePath(storage.root, extraction.file.storageKey))
      )
        continue;
      const approvedPageChecksums = new Map(
        extraction.ocrReviewApproval?.run.pages.map((page) => [
          page.pageNumber,
          page.status === 'APPROVED' ? page.approvedChecksum : null,
        ]) ?? [],
      );
      const pages: ResearchTextSourceProvenance['pages'] = [];
      for (const page of extraction.pages) {
        if (page.textKind === 'NATIVE') {
          pages.push({ pageNumber: page.pageNumber, source: 'PDF_TEXT' });
          continue;
        }
        const textSha256 = approvedPageChecksums.get(page.pageNumber);
        if (
          page.textKind === 'OCR' &&
          extraction.status === 'OCR_HUMAN_APPROVED' &&
          page.processingStatus === 'OCR_HUMAN_APPROVED' &&
          textSha256
        ) {
          pages.push({
            pageNumber: page.pageNumber,
            source: 'OCR_APPROVED',
            textSha256,
          });
        }
      }
      if (!pages.length) continue;
      const pageSources = new Set(pages.map((page) => page.source));
      const provenance: ResearchTextSourceProvenance = {
        source: pageSources.size > 1 ? 'MIXED' : pages[0].source,
        pdfSha256: extraction.file.sha256,
        extractorVersion: extraction.extractorVersion,
        ...(extraction.ocrReviewApproval?.searchTextChecksum
          ? {
              documentTextSha256:
                extraction.ocrReviewApproval.searchTextChecksum,
            }
          : {}),
        pages,
      };
      const sources =
        sourcesBySentence.get(link.targetId) ??
        new Map<string, ResearchTextSourceProvenance>();
      sources.set(extraction.file.sha256, provenance);
      sourcesBySentence.set(link.targetId, sources);
    }
    for (const [sentenceId, sources] of sourcesBySentence) {
      if (sources.size === 1)
        provenanceBySentence.set(sentenceId, [...sources.values()][0]);
    }
    const generatedAt = new Date();
    const bundle = buildResearchBundle({
      collection,
      generatedAt,
      ...(process.env.GIT_SHA ? { gitSha: process.env.GIT_SHA } : {}),
      omittedItemCount: Math.max(0, totalItemCount - items.length),
      judgments: items.map(({ sentencia, nota, createdAt }) => ({
        ...sentencia,
        nota,
        addedAt: createdAt,
        ...(provenanceBySentence.has(String(sentencia.id))
          ? { textProvenance: provenanceBySentence.get(String(sentencia.id)) }
          : {}),
      })),
    });

    await this.logsService.registrarAccion({
      usuarioId,
      entidad: 'RESEARCH_COLLECTION',
      entidadId: collection.id,
      accion: 'RESEARCH_BUNDLE_EXPORT',
      descripcion: `Exportó un dossier verificable con ${bundle.manifest.contents.judgmentCount} fallo(s).`,
      datosDespues: {
        bundleId: bundle.manifest.bundleId,
        generatedAt: bundle.manifest.generatedAt,
        judgmentCount: bundle.manifest.contents.judgmentCount,
        noteCount: bundle.manifest.contents.noteCount,
      },
    });

    return {
      stream: createResearchBundleZip(bundle.files),
      filename: bundle.downloadFilename,
      manifest: bundle.manifest,
    };
  }

  async findAll(usuarioId: number) {
    const collections = await this.prisma.researchCollection.findMany({
      where: { usuarioId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { items: true } } },
    });
    return {
      data: collections.map(({ _count, ...collection }) => ({
        ...collection,
        itemCount: _count.items,
      })),
    };
  }

  async findOne(usuarioId: number, id: number, query: CollectionItemsQueryDto) {
    const collection = await this.prisma.researchCollection.findFirst({
      where: { id, usuarioId },
      select: { id: true, nombre: true, createdAt: true, updatedAt: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');

    const q = query.q?.trim();
    const publicSentenceWhere: Prisma.SentenciaWhereInput = {
      publicado: true,
      activo: true,
    };
    const metadataWhere: Prisma.SentenciaWhereInput = q
      ? {
          ...publicSentenceWhere,
          OR: [
            { caratula: { contains: q, mode: 'insensitive' } },
            { numeroSentencia: { contains: q, mode: 'insensitive' } },
            { expediente: { contains: q, mode: 'insensitive' } },
            { sala: { contains: q, mode: 'insensitive' } },
          ],
        }
      : publicSentenceWhere;
    const where: Prisma.ResearchCollectionItemWhereInput = {
      collectionId: id,
      // Keep the visibility constraint outside the query OR: a match in a
      // private note must still include its published judgment even when the
      // judgment metadata itself does not contain the search term.
      sentencia: { is: publicSentenceWhere },
      ...(q
        ? {
            OR: [
              { nota: { contains: q, mode: 'insensitive' } },
              { sentencia: { is: metadataWhere } },
            ],
          }
        : {}),
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;
    const [total, items] = await Promise.all([
      this.prisma.researchCollectionItem.count({ where }),
      this.prisma.researchCollectionItem.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
        include: { sentencia: { select: PUBLIC_SENTENCE_SELECT } },
      }),
    ]);
    return {
      data: { ...collection, items },
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async create(usuarioId: number, dto: CreateCollectionDto) {
    try {
      const data = await this.prisma.researchCollection.create({
        data: {
          usuarioId,
          nombre: dto.nombre,
          nombreNormalizado: normalizedName(dto.nombre),
        },
      });
      return { data };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ya existe una colección con ese nombre');
      }
      throw error;
    }
  }

  async update(usuarioId: number, id: number, dto: UpdateCollectionDto) {
    await this.requireOwnedCollection(usuarioId, id);
    if (dto.nombre === undefined) {
      return this.findCollectionResponse(usuarioId, id);
    }
    try {
      const data = await this.prisma.researchCollection.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          nombreNormalizado: normalizedName(dto.nombre),
        },
      });
      return { data };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ya existe una colección con ese nombre');
      }
      throw error;
    }
  }

  async remove(usuarioId: number, id: number) {
    const result = await this.prisma.researchCollection.deleteMany({
      where: { id, usuarioId },
    });
    if (!result.count) throw new NotFoundException('Colección no encontrada');
    return { data: { deleted: true } };
  }

  async addJudgment(
    usuarioId: number,
    collectionId: number,
    sentenciaId: number,
  ) {
    await this.requireOwnedCollection(usuarioId, collectionId);
    const sentence = await this.prisma.sentencia.findFirst({
      where: { id: sentenciaId, publicado: true, activo: true },
      select: { id: true },
    });
    if (!sentence) throw new NotFoundException('Fallo publicado no encontrado');

    try {
      const data = await this.prisma.researchCollectionItem.create({
        data: { collectionId, sentenciaId },
      });
      return { data, added: true };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        const data = await this.prisma.researchCollectionItem.findUnique({
          where: { collectionId_sentenciaId: { collectionId, sentenciaId } },
        });
        if (data) return { data, added: false };
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException('Fallo publicado no encontrado');
      }
      throw error;
    }
  }

  async removeJudgment(
    usuarioId: number,
    collectionId: number,
    itemId: number,
  ) {
    const result = await this.prisma.researchCollectionItem.deleteMany({
      where: {
        id: itemId,
        collectionId,
        collection: { is: { usuarioId } },
      },
    });
    if (!result.count)
      throw new NotFoundException('Referencia de colección no encontrada');
    return { data: { deleted: true } };
  }

  async updateNote(
    usuarioId: number,
    collectionId: number,
    itemId: number,
    dto: UpdateCollectionNoteDto,
  ) {
    const result = await this.prisma.researchCollectionItem.updateMany({
      where: {
        id: itemId,
        collectionId,
        collection: { is: { usuarioId } },
      },
      data: { nota: dto.nota.trim() || null },
    });
    if (!result.count)
      throw new NotFoundException('Referencia de colección no encontrada');
    const data = await this.prisma.researchCollectionItem.findFirst({
      where: {
        id: itemId,
        collectionId,
        collection: { is: { usuarioId } },
      },
      select: { id: true, nota: true, updatedAt: true },
    });
    if (!data)
      throw new NotFoundException('Referencia de colección no encontrada');
    return { data };
  }

  private async requireOwnedCollection(usuarioId: number, id: number) {
    const collection = await this.prisma.researchCollection.findFirst({
      where: { id, usuarioId },
      select: { id: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    return collection;
  }

  private async findCollectionResponse(usuarioId: number, id: number) {
    const data = await this.prisma.researchCollection.findFirst({
      where: { id, usuarioId },
    });
    if (!data) throw new NotFoundException('Colección no encontrada');
    return { data };
  }
}

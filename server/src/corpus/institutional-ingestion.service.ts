import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname, resolve } from 'node:path';
import {
  Prisma,
  type InstitutionalIngestion,
} from '../generated/prisma/client';
import { ROLES } from '../auth/constants';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  expedienteEquivalentValues,
  normalizeExpediente,
} from '../sentencias/utils/expediente-normalizer';
import { CorpusIngestionService } from './corpus-ingestion.service';
import type { DiscoveredDocument } from './document-source.adapter';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import {
  BasicDocumentTextExtractor,
  EncryptedDocumentError,
  InvalidPdfError,
} from './document-text-extractor';
import type { ConfirmInstitutionalMetadataDto } from './institutional-ingestion.dto';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SOURCE_CODE = 'INSTITUTIONAL_UPLOAD';
const SOURCE_NAME = 'Ingreso institucional de jurisprudencia';
const READ_ROLES = new Set<string>([
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.JURISPRUDENCIA,
  ROLES.REVISOR,
]);
const WRITE_ROLES = new Set<string>([
  ROLES.ADMIN,
  ROLES.OPERADOR,
  ROLES.JURISPRUDENCIA,
]);

type Actor = { id: number; role: string };
type Candidate = {
  id: number;
  numeroSentencia: string | null;
  caratula: string | null;
  expediente: string | null;
  sala: string | null;
  fecha: Date | null;
  publicado: boolean;
  estadoCarga: string;
};
type MatchResult = {
  classification:
    'EXACT_UNIQUE' | 'MULTIPLE_EXACT' | 'PARTIAL_CANDIDATE' | 'NO_MATCH';
  candidates: Candidate[];
};
type Metadata = ConfirmInstitutionalMetadataDto & { fecha: string };

@Injectable()
export class InstitutionalIngestionService {
  private readonly storage = new LocalDocumentStorageAdapter();
  private readonly extractor = new BasicDocumentTextExtractor();
  private readonly corpusIngestion: CorpusIngestionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
  ) {
    this.corpusIngestion = new CorpusIngestionService(
      prisma,
      this.storage,
      this.extractor,
    );
  }

  async upload(
    file: Express.Multer.File | undefined,
    actor: Actor,
    idempotencyToken?: string,
  ) {
    this.requireWrite(actor);
    if (!file?.buffer?.length)
      throw new BadRequestException('Adjuntá un PDF para continuar.');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('El PDF supera el límite de 100 MB.');
    }
    const originalFilename = safeDisplayFilename(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const token = idempotencyToken?.trim() || randomUUID();
    if (token.length > 200)
      throw new BadRequestException('Clave de solicitud inválida.');
    const idempotencyKey = createHash('sha256')
      .update(`${actor.id}\0${token}`)
      .digest('hex');
    const prior = await this.prisma.institutionalIngestion.findUnique({
      where: { idempotencyKey },
      select: { id: true, sha256: true },
    });
    if (prior) {
      if (prior.sha256 !== sha256) {
        throw new ConflictException(
          'La misma solicitud ya fue usada con otro archivo.',
        );
      }
      return this.get(prior.id, actor);
    }

    const intake = await this.prisma.institutionalIngestion.create({
      data: {
        createdById: actor.id,
        status: 'VALIDATING',
        originalFilename,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: BigInt(file.size),
        sha256,
        idempotencyKey,
        events: {
          create: {
            actorId: actor.id,
            action: 'UPLOAD_RECEIVED',
            toStatus: 'VALIDATING',
            safeOutcome: { sizeBytes: file.size },
          },
        },
      },
    });
    await this.audit(actor.id, intake.id, 'UPLOAD_RECEIVED', {
      sha256,
      sizeBytes: file.size,
    });

    try {
      validatePdfEnvelope(file, originalFilename);
      const validation = await this.extractor.extract(
        originalFilename,
        'application/pdf',
        file.buffer,
      );
      if (validation.formatDetected !== 'PDF' || validation.pages.length < 1) {
        throw new InvalidPdfError('PDF sin páginas legibles.');
      }

      const sourcePath = `institutional-upload/${intake.id}`;
      const result = await this.prisma.$transaction(
        async (tx) => {
          // Serializes same-hash intake across app processes while the canonical
          // Corpus lookup and creation/reuse complete.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sha256}, 0)) IS NULL AS acquired`;
          const matches = await this.prisma.corpusDocumentFile.findMany({
            where: { sha256 },
            include: { document: { select: { id: true, status: true } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          const documentIds = [
            ...new Set(matches.map((item) => item.documentId)),
          ];
          if (documentIds.length > 1) {
            return {
              status: 'REVIEW_REQUIRED',
              duplicateDetected: true,
              extractionStatus: validation.status,
              matchClassification: 'MULTIPLE_CANONICAL_FILES',
              candidateIds: documentIds,
              safeOutcome: {
                duplicateMatches: matches.length,
                documentCount: documentIds.length,
              },
            };
          }

          const item: DiscoveredDocument = {
            filename: originalFilename,
            sourcePath,
            sourceReference: 'Carga institucional autorizada',
            obtainedAt: new Date(),
            content: file.buffer,
            mimeType: 'application/pdf',
            documentType: 'JUDGMENT',
            jurisdiction: 'CIVIL',
            visibility: 'INTERNAL',
            metadata: { intakeChannel: SOURCE_CODE },
            metadataOriginal: {
              originalFilename,
              sha256,
              institutionalIngestionId: intake.id,
            },
          };
          const outcome = matches.length
            ? await this.corpusIngestion.linkExisting(item, {
                sourceCode: SOURCE_CODE,
                sourceName: SOURCE_NAME,
                sourceType: 'MANUAL',
              })
            : await this.corpusIngestion.ingestOne(item, {
                sourceCode: SOURCE_CODE,
                sourceName: SOURCE_NAME,
                sourceType: 'MANUAL',
              });
          const fileRecord = await this.prisma.corpusDocumentFile.findUnique({
            where: {
              documentId_sha256: {
                documentId: outcome.documentId,
                sha256,
              },
            },
            select: { id: true },
          });
          if (!fileRecord) throw new Error('CANONICAL_FILE_REFERENCE_MISSING');
          const duplicateDetected = matches.length > 0;
          const status = duplicateDetected
            ? 'DUPLICATE_EXACT'
            : outcome.status === 'OCR_REQUIRED'
              ? 'OCR_REQUIRED'
              : outcome.status === 'INDEXED'
                ? 'METADATA_PENDING'
                : 'REVIEW_REQUIRED';
          return {
            status,
            duplicateDetected,
            extractionStatus: outcome.status,
            documentId: outcome.documentId,
            fileId: fileRecord.id,
            corpusIngestionId: outcome.ingestionId,
            safeOutcome: { status: outcome.status, duplicateDetected },
          };
        },
        { maxWait: 10000, timeout: 180000 },
      );

      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.institutionalIngestion.update({
          where: { id: intake.id },
          data: {
            status: result.status,
            duplicateDetected: result.duplicateDetected,
            extractionStatus: result.extractionStatus,
            matchClassification: result.matchClassification,
            candidateIds: result.candidateIds,
            documentId: result.documentId,
            fileId: result.fileId,
            corpusIngestionId: result.corpusIngestionId,
          },
        });
        await tx.institutionalIngestionEvent.create({
          data: {
            ingestionId: intake.id,
            actorId: actor.id,
            action: result.duplicateDetected
              ? 'DUPLICATE_DETECTED'
              : 'PDF_VALIDATED',
            fromStatus: 'VALIDATING',
            toStatus: result.status,
            safeOutcome: result.safeOutcome,
          },
        });
        return tx.institutionalIngestion.findUniqueOrThrow({
          where: { id: intake.id },
        });
      });
      await this.audit(
        actor.id,
        intake.id,
        result.duplicateDetected ? 'DUPLICATE_DETECTED' : 'PDF_VALIDATED',
        {
          sha256,
          documentId: updated.documentId,
          status: updated.status,
        },
      );
      return this.get(intake.id, actor);
    } catch (error) {
      const encrypted = error instanceof EncryptedDocumentError;
      const invalidPdf = error instanceof InvalidPdfError;
      const safeCode = encrypted
        ? 'UNSUPPORTED_ENCRYPTED_PDF'
        : invalidPdf
          ? 'INVALID_PDF'
          : errorCode(error) === 'ENOSPC'
            ? 'STORAGE_UNAVAILABLE'
            : 'INGESTION_FAILED';
      const safeStatus = encrypted ? 'REVIEW_REQUIRED' : 'FAILED';
      const safeMessage = encrypted
        ? 'El PDF está protegido con contraseña y requiere revisión institucional.'
        : invalidPdf
          ? 'El archivo no es un PDF válido o no contiene páginas legibles.'
          : safeCode === 'STORAGE_UNAVAILABLE'
            ? 'El almacenamiento no está disponible. El ingreso quedó registrado para revisión.'
            : 'No se pudo completar el ingreso. Revisá el estado antes de volver a cargar el archivo.';
      await this.prisma.$transaction(async (tx) => {
        await tx.institutionalIngestion.update({
          where: { id: intake.id },
          data: {
            status: safeStatus,
            failureCode: safeCode,
            failureMessageSafe: safeMessage,
            completedAt: safeStatus === 'FAILED' ? new Date() : null,
          },
        });
        await tx.institutionalIngestionEvent.create({
          data: {
            ingestionId: intake.id,
            actorId: actor.id,
            action:
              safeStatus === 'REVIEW_REQUIRED'
                ? 'REVIEW_REQUIRED'
                : 'UPLOAD_FAILED',
            fromStatus: 'VALIDATING',
            toStatus: safeStatus,
            safeOutcome: { code: safeCode },
          },
        });
      });
      await this.audit(
        actor.id,
        intake.id,
        safeStatus === 'FAILED' ? 'UPLOAD_FAILED' : 'REVIEW_REQUIRED',
        {
          sha256,
          code: safeCode,
        },
      );
      if (safeCode === 'STORAGE_UNAVAILABLE') {
        throw new ServiceUnavailableException(safeMessage);
      }
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException(safeMessage);
    }
  }

  async list(
    actor: Actor,
    query: { page?: string; pageSize?: string; status?: string; q?: string },
  ) {
    this.requireRead(actor);
    const page = positiveInteger(query.page, 1);
    const pageSize = Math.min(positiveInteger(query.pageSize, 25), 50);
    const q = query.q?.trim().slice(0, 160);
    const where: Prisma.InstitutionalIngestionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { originalFilename: { contains: q, mode: 'insensitive' } },
              {
                document: {
                  is: { title: { contains: q, mode: 'insensitive' } },
                },
              },
              {
                document: {
                  is: { caseNumber: { contains: q, mode: 'insensitive' } },
                },
              },
              {
                linkedSentencia: {
                  is: { expediente: { contains: q, mode: 'insensitive' } },
                },
              },
              {
                linkedSentencia: {
                  is: { caratula: { contains: q, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total, pending, ocr, duplicates, review, completed] =
      await this.prisma.$transaction([
        this.prisma.institutionalIngestion.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            linkedSentencia: {
              select: { id: true, expediente: true, caratula: true },
            },
          },
        }),
        this.prisma.institutionalIngestion.count({ where }),
        this.prisma.institutionalIngestion.count({
          where: {
            status: {
              in: [
                'METADATA_PENDING',
                'MATCH_CANDIDATE',
                'READY_TO_LINK',
                'READY_TO_CREATE_DRAFT',
              ],
            },
          },
        }),
        this.prisma.institutionalIngestion.count({
          where: { status: 'OCR_REQUIRED' },
        }),
        this.prisma.institutionalIngestion.count({
          where: { duplicateDetected: true },
        }),
        this.prisma.institutionalIngestion.count({
          where: { status: 'REVIEW_REQUIRED' },
        }),
        this.prisma.institutionalIngestion.count({
          where: { status: { in: ['LINKED', 'DRAFT_CREATED'] } },
        }),
      ]);
    return {
      data: items.map((item) => safeIngestion(item)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        counters: {
          pending,
          ocrRequired: ocr,
          duplicates,
          reviewRequired: review,
          completed,
        },
      },
    };
  }

  async get(id: string, actor: Actor) {
    this.requireRead(actor);
    const item = await this.prisma.institutionalIngestion.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            actor: { select: { id: true, nombre: true, apellido: true } },
          },
        },
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            visibility: true,
            latestExtraction: {
              select: {
                status: true,
                extractedAt: true,
                pages: { select: { pageNumber: true } },
              },
            },
          },
        },
        file: {
          select: {
            id: true,
            sha256: true,
            sizeBytes: true,
            pageCount: true,
            mimeType: true,
          },
        },
        linkedSentencia: {
          select: {
            id: true,
            expediente: true,
            caratula: true,
            sala: true,
            fecha: true,
            publicado: true,
            estadoCarga: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Ingreso no encontrado.');
    if (!this.canSee(item, actor))
      throw new NotFoundException('Ingreso no encontrado.');
    const candidates = item.candidateIds;
    const candidateIds = Array.isArray(candidates)
      ? candidates.filter(
          (candidate): candidate is number => typeof candidate === 'number',
        )
      : [];
    const candidateRows = candidateIds.length
      ? await this.prisma.sentencia.findMany({
          where: { id: { in: candidateIds } },
          select: {
            id: true,
            numeroSentencia: true,
            caratula: true,
            expediente: true,
            sala: true,
            fecha: true,
            publicado: true,
            estadoCarga: true,
          },
          orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        })
      : [];
    const duplicateDocumentIds = item.duplicateDetected
      ? [
          ...new Set([
            ...(item.documentId ? [item.documentId] : []),
            ...(Array.isArray(item.candidateIds)
              ? item.candidateIds.filter(
                  (candidate): candidate is string =>
                    typeof candidate === 'string',
                )
              : []),
          ]),
        ]
      : [];
    const duplicateDocuments = duplicateDocumentIds.length
      ? await this.prisma.corpusDocument.findMany({
          where: { id: { in: duplicateDocumentIds } },
          select: {
            id: true,
            title: true,
            status: true,
            files: {
              where: { sha256: item.sha256 },
              select: {
                id: true,
                sha256: true,
                pageCount: true,
                sizeBytes: true,
              },
            },
            links: {
              where: {
                targetDomain: 'JURISPRUDENCIA',
                targetType: 'SENTENCIA',
              },
              select: { targetId: true },
            },
          },
          orderBy: { id: 'asc' },
        })
      : [];
    const duplicateSentenceIds = [
      ...new Set(
        duplicateDocuments.flatMap((document) =>
          document.links
            .map((link) => Number(link.targetId))
            .filter((value) => Number.isSafeInteger(value) && value > 0),
        ),
      ),
    ];
    const duplicateSentencias = duplicateSentenceIds.length
      ? await this.prisma.sentencia.findMany({
          where: { id: { in: duplicateSentenceIds } },
          select: {
            id: true,
            expediente: true,
            caratula: true,
            sala: true,
            fecha: true,
            publicado: true,
            estadoCarga: true,
          },
          orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        })
      : [];
    return {
      data: {
        ...safeIngestion(item),
        document: item.document,
        file: item.file
          ? { ...item.file, sizeBytes: Number(item.file.sizeBytes) }
          : null,
        linkedSentencia: item.linkedSentencia,
        candidates: candidateRows,
        duplicateCandidates: duplicateDocuments.map((document) => ({
          id: document.id,
          title: document.title,
          status: document.status,
          files: document.files.map((file) => ({
            ...file,
            sizeBytes: Number(file.sizeBytes),
          })),
          linkedSentencias: duplicateSentencias.filter((sentence) =>
            document.links.some(
              (link) => Number(link.targetId) === sentence.id,
            ),
          ),
        })),
        events: item.events.map((event) => ({
          id: event.id,
          action: event.action,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          safeOutcome: event.safeOutcome,
          createdAt: event.createdAt,
          actor: event.actor,
        })),
      },
    };
  }

  async confirmMetadata(
    id: string,
    body: ConfirmInstitutionalMetadataDto,
    actor: Actor,
  ) {
    this.requireWrite(actor);
    const item = await this.loadForWrite(id, actor);
    if (
      !['METADATA_PENDING', 'OCR_REQUIRED', 'DUPLICATE_EXACT'].includes(
        item.status,
      )
    ) {
      throw new ConflictException(
        'Este ingreso no está pendiente de confirmar metadatos.',
      );
    }
    if (!item.documentId || !item.fileId) {
      throw new ConflictException(
        'El archivo duplicado requiere resolución institucional antes de continuar.',
      );
    }
    const metadata = validateMetadata(body);
    const match = await findSentenciaCandidates(this.prisma, metadata);
    const status =
      match.classification === 'NO_MATCH'
        ? 'READY_TO_CREATE_DRAFT'
        : match.classification === 'EXACT_UNIQUE'
          ? 'MATCH_CANDIDATE'
          : 'REVIEW_REQUIRED';
    const candidateIds = match.candidates.map((candidate) => candidate.id);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.institutionalIngestion.findUniqueOrThrow({
        where: { id },
      });
      if (
        !['METADATA_PENDING', 'OCR_REQUIRED', 'DUPLICATE_EXACT'].includes(
          current.status,
        )
      ) {
        throw new ConflictException(
          'El ingreso cambió mientras se confirmaban los datos.',
        );
      }
      if (!item.duplicateDetected) {
        const currentDocument = await tx.corpusDocument.findUniqueOrThrow({
          where: { id: item.documentId! },
          select: { metadataOriginal: true },
        });
        const priorMetadata = currentDocument.metadataOriginal;
        const priorMetadataObject =
          priorMetadata !== null &&
          typeof priorMetadata === 'object' &&
          !Array.isArray(priorMetadata)
            ? (priorMetadata as Prisma.InputJsonObject)
            : {};
        await tx.corpusDocument.update({
          where: { id: item.documentId! },
          data: {
            documentType: 'JUDGMENT',
            title: metadata.caratula,
            subtitle: metadata.expediente,
            jurisdiction: 'CIVIL',
            court: metadata.tribunalOrigen || undefined,
            chamber: metadata.sala,
            caseNumber: metadata.expediente,
            decisionDate: dateOnlyUtc(metadata.fecha),
            metadata: toJsonObject(metadata),
            metadataOriginal: {
              ...priorMetadataObject,
              intakeChannel: SOURCE_CODE,
              confirmedByUserId: actor.id,
              confirmedAt: new Date().toISOString(),
            },
          },
        });
      }
      await tx.institutionalIngestion.update({
        where: { id },
        data: {
          status,
          matchClassification: match.classification,
          candidateIds,
          confirmedMetadata: toJsonObject(metadata),
        },
      });
      await tx.institutionalIngestionEvent.create({
        data: {
          ingestionId: id,
          actorId: actor.id,
          action: 'METADATA_CONFIRMED',
          fromStatus: current.status,
          toStatus: status,
          safeOutcome: {
            classification: match.classification,
            candidateCount: candidateIds.length,
          },
        },
      });
    });
    await this.audit(actor.id, id, 'METADATA_CONFIRMED', {
      classification: match.classification,
      candidateCount: candidateIds.length,
    });
    return this.get(id, actor);
  }

  async linkExisting(id: string, sentenciaIdInput: string, actor: Actor) {
    this.requireWrite(actor);
    const item = await this.loadForWrite(id, actor);
    const sentenciaId = Number(sentenciaIdInput);
    if (!Number.isSafeInteger(sentenciaId) || sentenciaId <= 0) {
      throw new BadRequestException('Sentencia seleccionada inválida.');
    }
    if (item.status === 'LINKED' && item.linkedSentenciaId === sentenciaId)
      return this.get(id, actor);
    if (!['MATCH_CANDIDATE', 'REVIEW_REQUIRED'].includes(item.status)) {
      throw new ConflictException(
        'Este ingreso no tiene coincidencias pendientes de confirmar.',
      );
    }
    if (!item.documentId || !item.fileId || !item.confirmedMetadata) {
      throw new ConflictException(
        'El ingreso no tiene un archivo y metadatos confirmados.',
      );
    }
    const documentId = item.documentId;
    const fileId = item.fileId;
    const allowedIds = numericIds(item.candidateIds);
    if (!allowedIds.includes(sentenciaId)) {
      throw new ConflictException(
        'La sentencia elegida no pertenece a las coincidencias revisadas.',
      );
    }
    let sameFileAlreadyLinked = false;
    await this.prisma.$transaction(async (tx) => {
      // Serialize all legal links for a canonical PDF, including distinct
      // intake attempts that reused the same SHA-256 Corpus object.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`institutional-document-link:${documentId}`}, 0)) IS NULL AS acquired`;
      const current = await tx.institutionalIngestion.findUniqueOrThrow({
        where: { id },
      });
      if (
        current.status === 'LINKED' &&
        current.linkedSentenciaId === sentenciaId
      )
        return;
      if (!['MATCH_CANDIDATE', 'REVIEW_REQUIRED'].includes(current.status)) {
        throw new ConflictException(
          'El ingreso cambió antes de confirmar el vínculo.',
        );
      }
      if (
        current.documentId !== documentId ||
        current.fileId !== fileId ||
        !current.confirmedMetadata
      ) {
        throw new ConflictException(
          'El archivo o sus metadatos cambiaron antes de confirmar el vínculo.',
        );
      }
      const currentMetadata = parseMetadata(current.confirmedMetadata);
      const currentMatches = await findSentenciaCandidates(tx, currentMetadata);
      if (
        !currentMatches.candidates.some(
          (candidate) => candidate.id === sentenciaId,
        )
      ) {
        throw new ConflictException(
          'La sentencia dejó de coincidir con los datos confirmados. Revisá las coincidencias antes de continuar.',
        );
      }
      const file = await tx.corpusDocumentFile.findUniqueOrThrow({
        where: { id: fileId },
      });
      const absolutePath = resolve(this.storage.root, file.storageKey);
      const sentence = await tx.sentencia.findUnique({
        where: { id: sentenciaId },
        select: { id: true, archivosPdf: { select: { rutaArchivo: true } } },
      });
      if (!sentence)
        throw new ConflictException('La sentencia ya no está disponible.');
      sameFileAlreadyLinked = sentence.archivosPdf.some(
        (pdf) => resolve(pdf.rutaArchivo) === absolutePath,
      );
      const differentPdfExists = sentence.archivosPdf.some(
        (pdf) => resolve(pdf.rutaArchivo) !== absolutePath,
      );
      if (differentPdfExists && !sameFileAlreadyLinked) {
        throw new ConflictException(
          'La sentencia ya tiene otro PDF. No se reemplazó; requiere resolución institucional.',
        );
      }
      const priorSentenciaLinks = await tx.corpusDocumentLink.findMany({
        where: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
        },
        select: { targetId: true },
      });
      if (
        priorSentenciaLinks.some(
          (link) => link.targetId !== String(sentenciaId),
        )
      ) {
        throw new ConflictException(
          'Este PDF ya está vinculado a otra sentencia; requiere resolución institucional.',
        );
      }
      if (!sameFileAlreadyLinked) {
        await tx.archivoPdf.create({
          data: {
            nombreArchivo: `${file.sha256}.pdf`,
            nombreOriginal: item.originalFilename,
            rutaArchivo: absolutePath,
            mimeType: 'application/pdf',
            tamanioBytes: Number(file.sizeBytes),
            sentenciaId,
          },
        });
      }
      await tx.sentencia.update({
        where: { id: sentenciaId },
        data: { tienePdf: true },
      });
      await tx.corpusDocumentLink.upsert({
        where: {
          documentId_targetDomain_targetType_targetId_relationship: {
            documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: String(sentenciaId),
            relationship: 'ASSOCIATED_WITH',
          },
        },
        create: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: String(sentenciaId),
          relationship: 'ASSOCIATED_WITH',
          metadata: { intakeChannel: SOURCE_CODE, ingestionId: id },
        },
        update: {},
      });
      await tx.institutionalIngestion.update({
        where: { id },
        data: {
          status: 'LINKED',
          linkedSentenciaId: sentenciaId,
          completedAt: new Date(),
        },
      });
      await tx.institutionalIngestionEvent.create({
        data: {
          ingestionId: id,
          actorId: actor.id,
          action: sameFileAlreadyLinked
            ? 'LINK_CONFIRMED_NOOP'
            : 'SENTENCIA_LINKED',
          fromStatus: current.status,
          toStatus: 'LINKED',
          safeOutcome: { sentenciaId, alreadyLinked: sameFileAlreadyLinked },
        },
      });
    });
    await this.audit(actor.id, id, 'SENTENCIA_LINKED', {
      sentenciaId,
      alreadyLinked: sameFileAlreadyLinked,
    });
    return this.get(id, actor);
  }

  async createDraft(id: string, actor: Actor) {
    this.requireWrite(actor);
    const item = await this.loadForWrite(id, actor);
    if (item.status === 'DRAFT_CREATED') return this.get(id, actor);
    if (
      item.status !== 'READY_TO_CREATE_DRAFT' ||
      item.matchClassification !== 'NO_MATCH'
    ) {
      throw new ConflictException(
        'Primero resolvé las coincidencias antes de crear una sentencia.',
      );
    }
    if (!item.documentId || !item.fileId || !item.confirmedMetadata) {
      throw new ConflictException(
        'El ingreso no tiene un archivo y metadatos confirmados.',
      );
    }
    const documentId = item.documentId;
    const fileId = item.fileId;
    const metadata = parseMetadata(item.confirmedMetadata);
    const draft = await this.prisma.$transaction(
      async (tx) => {
        const identity = `${normalizeExpediente(metadata.expediente) ?? metadata.expediente}|${metadata.fecha}|${metadata.sala.normalize('NFKC').trim().toLocaleUpperCase('en-US')}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`institutional-document-link:${documentId}`}, 0)) IS NULL AS acquired`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`institutional-sentence:${identity}`}, 0)) IS NULL AS acquired`;
        const current = await tx.institutionalIngestion.findUniqueOrThrow({
          where: { id },
        });
        if (current.status === 'DRAFT_CREATED')
          return current.linkedSentenciaId!;
        if (
          current.status !== 'READY_TO_CREATE_DRAFT' ||
          current.matchClassification !== 'NO_MATCH' ||
          current.documentId !== documentId ||
          current.fileId !== fileId ||
          !current.confirmedMetadata
        ) {
          throw new ConflictException(
            'El ingreso cambió antes de crear el borrador. Revisá el estado y los metadatos.',
          );
        }
        const currentMetadata = parseMetadata(current.confirmedMetadata);
        const currentIdentity = `${normalizeExpediente(currentMetadata.expediente) ?? currentMetadata.expediente}|${currentMetadata.fecha}|${currentMetadata.sala.normalize('NFKC').trim().toLocaleUpperCase('en-US')}`;
        if (currentIdentity !== identity) {
          throw new ConflictException(
            'Los metadatos cambiaron antes de crear el borrador. Confirmalos nuevamente.',
          );
        }
        const currentMatches = await findSentenciaCandidates(tx, metadata);
        if (currentMatches.classification !== 'NO_MATCH') {
          throw new ConflictException(
            'Apareció una coincidencia mientras se preparaba el borrador. Revisala antes de continuar.',
          );
        }
        const priorSentenciaLinks = await tx.corpusDocumentLink.findMany({
          where: {
            documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
          },
          select: { targetId: true },
        });
        if (priorSentenciaLinks.length) {
          throw new ConflictException(
            'El PDF exacto ya está vinculado a una sentencia. Revisá el vínculo existente.',
          );
        }
        const file = await tx.corpusDocumentFile.findUniqueOrThrow({
          where: { id: fileId },
        });
        const absolutePath = resolve(this.storage.root, file.storageKey);
        const fecha = dateOnlyUtc(metadata.fecha);
        const sentencia = await tx.sentencia.create({
          data: {
            numeroSentencia: metadata.numeroSentencia || null,
            tipoFallo: metadata.tipoFallo || null,
            sala: metadata.sala,
            fecha,
            expediente: metadata.expediente,
            tribunalOrigen: metadata.tribunalOrigen || null,
            caratula: metadata.caratula,
            magistrados: metadata.magistrados || null,
            observacionesInternas: metadata.observacionesInternas || null,
            anio: fecha.getUTCFullYear(),
            estadoCarga: 'BORRADOR',
            publicado: false,
            publishedAt: null,
            activo: true,
            tienePdf: true,
          },
        });
        await tx.archivoPdf.create({
          data: {
            nombreArchivo: `${file.sha256}.pdf`,
            nombreOriginal: item.originalFilename,
            rutaArchivo: absolutePath,
            mimeType: 'application/pdf',
            tamanioBytes: Number(file.sizeBytes),
            sentenciaId: sentencia.id,
          },
        });
        await tx.corpusDocumentLink.upsert({
          where: {
            documentId_targetDomain_targetType_targetId_relationship: {
              documentId,
              targetDomain: 'JURISPRUDENCIA',
              targetType: 'SENTENCIA',
              targetId: String(sentencia.id),
              relationship: 'ASSOCIATED_WITH',
            },
          },
          create: {
            documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: String(sentencia.id),
            relationship: 'ASSOCIATED_WITH',
            metadata: { intakeChannel: SOURCE_CODE, ingestionId: id },
          },
          update: {},
        });
        await tx.institutionalIngestion.update({
          where: { id },
          data: {
            status: 'DRAFT_CREATED',
            linkedSentenciaId: sentencia.id,
            completedAt: new Date(),
          },
        });
        await tx.institutionalIngestionEvent.create({
          data: {
            ingestionId: id,
            actorId: actor.id,
            action: 'DRAFT_SENTENCIA_CREATED',
            fromStatus: current.status,
            toStatus: 'DRAFT_CREATED',
            safeOutcome: { sentenciaId: sentencia.id, published: false },
          },
        });
        return sentencia.id;
      },
      { maxWait: 10000, timeout: 30000 },
    );
    await this.audit(actor.id, id, 'DRAFT_SENTENCIA_CREATED', {
      sentenciaId: draft,
      published: false,
    });
    return this.get(id, actor);
  }

  async cancel(id: string, actor: Actor) {
    this.requireWrite(actor);
    const item = await this.loadForWrite(id, actor);
    if (['LINKED', 'DRAFT_CREATED'].includes(item.status)) {
      throw new ConflictException(
        'Un ingreso ya vinculado no se puede cancelar desde esta pantalla.',
      );
    }
    if (item.status === 'CANCELLED') return this.get(id, actor);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.institutionalIngestion.findUniqueOrThrow({
        where: { id },
      });
      if (['LINKED', 'DRAFT_CREATED'].includes(current.status)) {
        throw new ConflictException('El ingreso ya fue vinculado.');
      }
      await tx.institutionalIngestion.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await tx.institutionalIngestionEvent.create({
        data: {
          ingestionId: id,
          actorId: actor.id,
          action: 'WORKFLOW_CANCELLED',
          fromStatus: current.status,
          toStatus: 'CANCELLED',
          safeOutcome: {},
        },
      });
    });
    await this.audit(actor.id, id, 'WORKFLOW_CANCELLED', {});
    return this.get(id, actor);
  }

  async retryExtraction(id: string, actor: Actor) {
    this.requireWrite(actor);
    const item = await this.loadForWrite(id, actor);
    if (
      !item.documentId ||
      !['REVIEW_REQUIRED', 'OCR_REQUIRED'].includes(item.status)
    ) {
      throw new ConflictException(
        'Este ingreso no tiene una extracción reintentable.',
      );
    }
    const outcome = await this.corpusIngestion.retryExtraction(item.documentId);
    const status =
      outcome.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'METADATA_PENDING';
    await this.prisma.$transaction(async (tx) => {
      await tx.institutionalIngestion.update({
        where: { id },
        data: {
          status,
          extractionStatus: outcome.status,
          failureCode: null,
          failureMessageSafe: null,
        },
      });
      await tx.institutionalIngestionEvent.create({
        data: {
          ingestionId: id,
          actorId: actor.id,
          action: 'EXTRACTION_RETRIED',
          fromStatus: item.status,
          toStatus: status,
          safeOutcome: { extractionStatus: outcome.status },
        },
      });
    });
    await this.audit(actor.id, id, 'EXTRACTION_RETRIED', { status });
    return this.get(id, actor);
  }

  private async loadForWrite(id: string, actor: Actor) {
    const item = await this.prisma.institutionalIngestion.findUnique({
      where: { id },
    });
    if (!item || !this.canSee(item, actor))
      throw new NotFoundException('Ingreso no encontrado.');
    return item;
  }

  private canSee(
    item: Pick<InstitutionalIngestion, 'createdById'>,
    actor: Actor,
  ) {
    return item.createdById === actor.id || READ_ROLES.has(actor.role);
  }

  private requireRead(actor: Actor) {
    if (!READ_ROLES.has(actor.role))
      throw new ForbiddenException(
        'No tenés permisos para ver ingresos institucionales.',
      );
  }

  private requireWrite(actor: Actor) {
    if (!WRITE_ROLES.has(actor.role))
      throw new ForbiddenException(
        'No tenés permisos para gestionar ingresos institucionales.',
      );
  }

  private async audit(
    actorId: number,
    id: string,
    action: string,
    outcome: Record<string, unknown>,
  ) {
    await this.logs.registrarAccion({
      usuarioId: actorId,
      entidad: 'INGRESO_INSTITUCIONAL',
      accion: action,
      descripcion: 'Acción sobre ingreso institucional de jurisprudencia',
      datosDespues: { ingestionId: id, ...outcome },
    });
  }
}

function validatePdfEnvelope(file: Express.Multer.File, filename: string) {
  if (
    extname(filename).toLowerCase() !== '.pdf' ||
    file.mimetype !== 'application/pdf'
  ) {
    throw new InvalidPdfError('Tipo de archivo no permitido.');
  }
  if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new InvalidPdfError('Firma PDF ausente.');
  }
  if (
    file.size !== file.buffer.byteLength ||
    file.size <= 0 ||
    file.size > MAX_UPLOAD_BYTES
  ) {
    throw new InvalidPdfError('Tamaño de archivo inválido.');
  }
}

function safeDisplayFilename(raw: string | undefined) {
  const value = raw?.trim() ?? '';
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* invalid encoding is rejected below */
  }
  if (
    !value ||
    value.length > 255 ||
    /[\\/:]/u.test(value) ||
    hasPathControlCharacter(value) ||
    hasPathControlCharacter(decoded) ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    /(?:^|\/)\.\.(?:\/|$)/u.test(decoded) ||
    /^[a-z]:/iu.test(decoded) ||
    decoded.startsWith('\\\\') ||
    /%(?:2e|2f|5c)/iu.test(value)
  ) {
    throw new BadRequestException('El nombre del archivo no es válido.');
  }
  const clean = basename(value).trim();
  if (!clean || clean === '.' || clean === '..')
    throw new BadRequestException('El nombre del archivo no es válido.');
  return clean;
}

function hasPathControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function validateMetadata(body: ConfirmInstitutionalMetadataDto): Metadata {
  const expediente = body.expediente.trim().replace(/\s+/gu, ' ');
  const sala = body.sala.trim().replace(/\s+/gu, ' ');
  const caratula = body.caratula.trim().replace(/\s+/gu, ' ');
  if (!normalizeExpediente(expediente)) {
    throw new BadRequestException(
      'El expediente debe incluir identificador y año, por ejemplo “123/2026”.',
    );
  }
  if (!sala || !caratula)
    throw new BadRequestException('Completá Sala y carátula.');
  const date = body.fecha;
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    dateOnlyUtc(date).toISOString().slice(0, 10) !== date
  ) {
    throw new BadRequestException(
      'La fecha del fallo debe tener formato YYYY-MM-DD.',
    );
  }
  return {
    ...body,
    expediente,
    sala,
    caratula,
    fecha: date,
    numeroSentencia: body.numeroSentencia?.trim() || undefined,
    tipoFallo: body.tipoFallo?.trim() || undefined,
    tribunalOrigen: body.tribunalOrigen?.trim() || undefined,
    magistrados: body.magistrados?.trim() || undefined,
    observacionesInternas: body.observacionesInternas?.trim() || undefined,
  };
}

function parseMetadata(value: Prisma.JsonValue): Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConflictException(
      'Los metadatos confirmados no están disponibles.',
    );
  return validateMetadata(value as unknown as ConfirmInstitutionalMetadataDto);
}

function dateOnlyUtc(date: string) {
  return new Date(`${date}T12:00:00.000Z`);
}

function toJsonObject(value: object): Prisma.InputJsonObject {
  const entries = Object.entries(
    value as Record<string, Prisma.InputJsonValue | undefined>,
  ).filter(
    (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
  );
  return Object.fromEntries<Prisma.InputJsonValue>(entries);
}

async function findSentenciaCandidates(
  client: Pick<Prisma.TransactionClient, 'sentencia'> | PrismaService,
  metadata: Metadata,
): Promise<MatchResult> {
  const expedienteValues = expedienteEquivalentValues(metadata.expediente);
  const dayStart = new Date(`${metadata.fecha}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dateFilter = { gte: dayStart, lt: dayEnd };
  const exactWhere: Prisma.SentenciaWhereInput[] = [];
  if (expedienteValues.length && metadata.sala) {
    exactWhere.push({
      expediente: { in: expedienteValues, mode: 'insensitive' },
      fecha: dateFilter,
      sala: { equals: metadata.sala, mode: 'insensitive' },
    });
  }
  if (metadata.numeroSentencia && metadata.sala) {
    exactWhere.push({
      numeroSentencia: {
        equals: metadata.numeroSentencia,
        mode: 'insensitive',
      },
      fecha: dateFilter,
      sala: { equals: metadata.sala, mode: 'insensitive' },
    });
  }
  const select = {
    id: true,
    numeroSentencia: true,
    caratula: true,
    expediente: true,
    sala: true,
    fecha: true,
    publicado: true,
    estadoCarga: true,
  } as const;
  const exact = exactWhere.length
    ? await client.sentencia.findMany({
        where: { OR: exactWhere },
        select,
        take: 51,
        orderBy: [{ id: 'asc' }],
      })
    : [];
  const uniqueExact = [
    ...new Map(exact.map((candidate) => [candidate.id, candidate])).values(),
  ];
  if (uniqueExact.length) {
    return {
      classification:
        uniqueExact.length === 1 ? 'EXACT_UNIQUE' : 'MULTIPLE_EXACT',
      candidates: uniqueExact.slice(0, 50),
    };
  }
  const partialOr: Prisma.SentenciaWhereInput[] = [];
  if (expedienteValues.length)
    partialOr.push({
      expediente: { in: expedienteValues, mode: 'insensitive' },
    });
  if (metadata.numeroSentencia)
    partialOr.push({
      numeroSentencia: {
        equals: metadata.numeroSentencia,
        mode: 'insensitive',
      },
    });
  const partial = partialOr.length
    ? await client.sentencia.findMany({
        where: { OR: partialOr },
        select,
        take: 21,
        orderBy: [{ id: 'asc' }],
      })
    : [];
  return {
    classification: partial.length ? 'PARTIAL_CANDIDATE' : 'NO_MATCH',
    candidates: partial.slice(0, 20),
  };
}

function numericIds(value: Prisma.JsonValue | null): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === 'number' && Number.isSafeInteger(item),
      )
    : [];
}

function safeIngestion(
  item: InstitutionalIngestion & { linkedSentencia?: unknown },
) {
  return {
    id: item.id,
    status: item.status,
    originalFilename: item.originalFilename,
    mimeType: item.mimeType,
    sizeBytes: Number(item.sizeBytes),
    sha256: item.sha256,
    duplicateDetected: item.duplicateDetected,
    extractionStatus: item.extractionStatus,
    matchClassification: item.matchClassification,
    documentId: item.documentId,
    fileId: item.fileId,
    linkedSentenciaId: item.linkedSentenciaId,
    confirmedMetadata: item.confirmedMetadata,
    failureCode: item.failureCode,
    failureMessageSafe: item.failureMessageSafe,
    completedAt: item.completedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

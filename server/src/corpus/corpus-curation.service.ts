import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PILOT_SOURCES = ['JURISPRUDENCIA_LOCAL_PDF', 'DIGESTO_LOCAL'];
const INSTITUTIONAL = {
  ingestions: {
    some: { sourceSystem: { is: { code: { in: PILOT_SOURCES } } } },
  },
} satisfies Prisma.CorpusDocumentWhereInput;
const JURISPRUDENCE_SOURCE = {
  ingestions: {
    some: { sourceSystem: { is: { code: 'JURISPRUDENCIA_LOCAL_PDF' } } },
  },
} satisfies Prisma.CorpusDocumentWhereInput;

@Injectable()
export class CorpusCurationService {
  constructor(private readonly prisma: PrismaService) {}

  async document(documentId: string, isAdmin: boolean) {
    const document = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        ...INSTITUTIONAL,
        visibility: isAdmin
          ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
          : { in: ['PUBLIC', 'INTERNAL'] },
      },
      select: {
        id: true,
        title: true,
        editorialStatus: true,
        visibility: true,
        anonymizationStatus: true,
        metadata: true,
        associations: { orderBy: { createdAt: 'desc' }, take: 20 },
        classifications: { orderBy: { createdAt: 'desc' }, take: 100 },
        digestoCollections: {
          include: {
            collection: { select: { id: true, name: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        digestoTopics: {
          include: { topic: { select: { id: true, name: true } } },
        },
        digestoTags: { include: { tag: { select: { id: true, name: true } } } },
        links: {
          where: {
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            relationship: 'ASSOCIATED_WITH',
          },
          select: { targetId: true },
        },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    const sentenceIds = document.links
      .map((link) => Number(link.targetId))
      .filter((id) => Number.isInteger(id) && id > 0);
    const linkedSentencias = sentenceIds.length
      ? await this.prisma.sentencia.findMany({
          where: { id: { in: sentenceIds } },
          select: {
            id: true,
            caratula: true,
            expediente: true,
            fecha: true,
            sala: true,
            sumarios: {
              where: { activo: true },
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                numeroSumario: true,
                tema: true,
                texto: true,
              },
            },
          },
        })
      : [];
    const history = await this.prisma.accionLog.findMany({
      where: {
        entidad: 'CorpusDocument',
        datosDespues: { path: ['documentId'], equals: documentId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        accion: true,
        descripcion: true,
        datosAntes: true,
        datosDespues: true,
        createdAt: true,
        usuario: { select: { nombre: true, apellido: true } },
      },
    });
    return { ...document, linkedSentencias, history };
  }

  async reviewAssociation(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    userId: number,
    isAdmin: boolean,
  ) {
    if (!['APPROVED', 'REJECTED'].includes(status))
      throw new BadRequestException('Estado de asociación inválido.');
    const association = await this.prisma.corpusDocumentAssociation.findUnique({
      where: { id },
      include: { document: { select: { id: true, title: true } } },
    });
    if (
      !association ||
      (!isAdmin &&
        (
          await this.prisma.corpusDocument.findUnique({
            where: { id: association.documentId },
            select: { visibility: true },
          })
        )?.visibility === 'RESTRICTED')
    )
      throw new NotFoundException('Asociación no encontrada.');
    if (association.reviewStatus !== 'REVIEW_PENDING')
      throw new BadRequestException('La asociación ya fue revisada.');
    let sentenceId: number | null = null;
    if (status === 'APPROVED') {
      if (
        association.confidence === 'UNRESOLVED' ||
        association.targetDomain !== 'JURISPRUDENCIA' ||
        association.targetType !== 'SENTENCIA' ||
        !/^\d+$/.test(association.targetId)
      ) {
        throw new BadRequestException(
          'Esta sugerencia no contiene un ID de sentencia verificable.',
        );
      }
      sentenceId = Number(association.targetId);
      const sentence = await this.prisma.sentencia.findUnique({
        where: { id: sentenceId },
        select: { id: true },
      });
      if (!sentence)
        throw new BadRequestException('La sentencia asociada ya no existe.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentAssociation.update({
        where: { id },
        data: {
          reviewStatus: status,
          reviewedBy: String(userId),
          reviewedAt: new Date(),
        },
      });
      if (status === 'APPROVED' && sentenceId !== null) {
        await tx.corpusDocumentLink.upsert({
          where: {
            documentId_targetDomain_targetType_targetId_relationship: {
              documentId: association.documentId,
              targetDomain: 'JURISPRUDENCIA',
              targetType: 'SENTENCIA',
              targetId: String(sentenceId),
              relationship: 'ASSOCIATED_WITH',
            },
          },
          update: {},
          create: {
            documentId: association.documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: String(sentenceId),
            relationship: 'ASSOCIATED_WITH',
            metadata: { associationId: id, reviewedBy: userId },
          },
        });
      }
      await this.audit(
        tx,
        userId,
        association.documentId,
        `ASSOCIATION_${status}`,
        { id, confidence: association.confidence },
        { id, status, sentenceId },
      );
    });
    return { id, status, sentenceId };
  }

  async reviewClassification(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    userId: number,
    isAdmin: boolean,
    category?: string,
    value?: string,
  ) {
    if (!['APPROVED', 'REJECTED'].includes(status))
      throw new BadRequestException('Estado de clasificación inválido.');
    const item = await this.prisma.corpusDocumentClassification.findUnique({
      where: { id },
    });
    if (
      !item ||
      (!isAdmin &&
        (
          await this.prisma.corpusDocument.findUnique({
            where: { id: item.documentId },
            select: { visibility: true },
          })
        )?.visibility === 'RESTRICTED')
    )
      throw new NotFoundException('Clasificación no encontrada.');
    if (item.reviewStatus !== 'SUGGESTED')
      throw new BadRequestException('La clasificación ya fue revisada.');
    const nextCategory = category?.trim() || item.category;
    const nextValue = value?.trim() || item.value;
    if (status === 'APPROVED' && (!nextCategory || !nextValue))
      throw new BadRequestException('Categoría y tema son obligatorios.');
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentClassification.update({
        where: { id },
        data: {
          category: nextCategory,
          value: nextValue,
          reviewStatus: status,
          reviewedBy: String(userId),
          reviewedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        userId,
        item.documentId,
        `CLASSIFICATION_${status}`,
        {
          id,
          category: item.category,
          value: item.value,
          status: item.reviewStatus,
        },
        { id, category: nextCategory, value: nextValue, status },
      );
    });
    return { id, category: nextCategory, value: nextValue, status };
  }

  async batchClassifications(
    ids: string[],
    status: 'APPROVED' | 'REJECTED',
    userId: number,
    isAdmin: boolean,
  ) {
    if (!['APPROVED', 'REJECTED'].includes(status))
      throw new BadRequestException('Estado de clasificación inválido.');
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 20)
      throw new BadRequestException('Seleccione entre 1 y 20 sugerencias.');
    const items = await this.prisma.corpusDocumentClassification.findMany({
      where: {
        id: { in: unique },
        reviewStatus: 'SUGGESTED',
        document: {
          ...INSTITUTIONAL,
          visibility: isAdmin
            ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
            : { in: ['PUBLIC', 'INTERNAL'] },
        },
      },
      select: {
        id: true,
        documentId: true,
        category: true,
        value: true,
        reviewStatus: true,
      },
    });
    if (items.length !== unique.length)
      throw new BadRequestException(
        'Una o más sugerencias no están pendientes o no pertenecen al corpus institucional.',
      );
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.corpusDocumentClassification.update({
          where: { id: item.id },
          data: {
            reviewStatus: status,
            reviewedBy: String(userId),
            reviewedAt: new Date(),
          },
        });
        await this.audit(
          tx,
          userId,
          item.documentId,
          `CLASSIFICATION_${status}`,
          { id: item.id, value: item.value, status: 'SUGGESTED' },
          { id: item.id, value: item.value, status, batch: true },
        );
      }
      await this.audit(
        tx,
        userId,
        null,
        `CLASSIFICATION_BATCH_${status}`,
        null,
        {
          documentIds: [...new Set(items.map((item) => item.documentId))],
          classificationIds: items.map((item) => item.id),
          count: items.length,
          status,
        },
      );
    });
    return { updated: items.length, status };
  }

  async revertClassification(
    id: string,
    reason: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const note = reason.trim();
    if (!note || note.length > 1000)
      throw new BadRequestException(
        'Indique un motivo de reversión de hasta 1000 caracteres.',
      );
    const item = await this.prisma.corpusDocumentClassification.findUnique({
      where: { id },
    });
    const document = item
      ? await this.prisma.corpusDocument.findFirst({
          where: {
            id: item.documentId,
            ...INSTITUTIONAL,
            visibility: isAdmin
              ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
              : { in: ['PUBLIC', 'INTERNAL'] },
          },
          select: { id: true },
        })
      : null;
    if (!item || !document)
      throw new NotFoundException('Clasificación no encontrada.');
    if (!['APPROVED', 'REJECTED'].includes(item.reviewStatus))
      throw new BadRequestException(
        'Sólo se puede revertir una decisión revisada.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentClassification.update({
        where: { id },
        data: { reviewStatus: 'SUGGESTED', reviewedBy: null, reviewedAt: null },
      });
      await this.audit(
        tx,
        userId,
        item.documentId,
        'CLASSIFICATION_REVERTED',
        {
          id,
          status: item.reviewStatus,
          reviewedBy: item.reviewedBy,
          reviewedAt: item.reviewedAt,
        },
        { id, status: 'SUGGESTED', reason: note },
      );
    });
    return { id, status: 'SUGGESTED', revertedFrom: item.reviewStatus };
  }

  async previewBatchMembership(
    collectionId: string,
    documentIds: string[],
    isAdmin: boolean,
  ) {
    const unique = this.validateBatchIds(documentIds);
    const collection = await this.prisma.digestoCollection.findFirst({
      where: { id: collectionId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada.');
    const visibility = isAdmin
      ? {
          in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as Array<
            'PUBLIC' | 'INTERNAL' | 'RESTRICTED'
          >,
        }
      : { in: ['PUBLIC', 'INTERNAL'] as Array<'PUBLIC' | 'INTERNAL'> };
    const documents = await this.prisma.corpusDocument.findMany({
      where: { id: { in: unique }, ...INSTITUTIONAL, visibility },
      select: {
        id: true,
        digestoCollections: {
          where: { collectionId },
          select: { documentId: true },
        },
      },
    });
    const byId = new Map(documents.map((item) => [item.id, item]));
    return {
      collectionId,
      requested: unique.length,
      maxBatchSize: 50,
      results: unique.map((id) => {
        const item = byId.get(id);
        return {
          documentId: id,
          status: !item
            ? 'not_eligible'
            : item.digestoCollections.length
              ? 'already_present'
              : 'would_add',
        };
      }),
    };
  }

  async batchMembership(
    collectionId: string,
    documentIds: string[],
    userId: number,
    isAdmin: boolean,
  ) {
    const preview = await this.previewBatchMembership(
      collectionId,
      documentIds,
      isAdmin,
    );
    const addIds = preview.results
      .filter((item) => item.status === 'would_add')
      .map((item) => item.documentId);
    await this.prisma.$transaction(async (tx) => {
      for (const documentId of addIds) {
        await tx.digestoCollectionMembership.create({
          data: { collectionId, documentId },
        });
        await tx.corpusDocumentLink.upsert({
          where: {
            documentId_targetDomain_targetType_targetId_relationship: {
              documentId,
              targetDomain: 'DIGESTO',
              targetType: 'COLLECTION',
              targetId: collectionId,
              relationship: 'MEMBER_OF',
            },
          },
          update: {},
          create: {
            documentId,
            targetDomain: 'DIGESTO',
            targetType: 'COLLECTION',
            targetId: collectionId,
            relationship: 'MEMBER_OF',
          },
        });
        await this.audit(
          tx,
          userId,
          documentId,
          'DIGESTO_COLLECTION_ADDED',
          null,
          { collectionId, batch: true },
        );
      }
      if (addIds.length)
        await this.audit(
          tx,
          userId,
          null,
          'DIGESTO_COLLECTION_BATCH_ADDED',
          null,
          { collectionId, documentIds: addIds, count: addIds.length },
        );
    });
    return {
      collectionId,
      added: addIds.length,
      alreadyPresent: preview.results.filter(
        (item) => item.status === 'already_present',
      ).length,
      notEligible: preview.results.filter(
        (item) => item.status === 'not_eligible',
      ).length,
      results: preview.results.map((item) => ({
        ...item,
        status: item.status === 'would_add' ? 'added' : item.status,
      })),
    };
  }

  async previewBatchJurisprudenceReview(
    documentIds: string[],
    isAdmin: boolean,
  ) {
    const unique = this.validateBatchIds(documentIds);
    const visibility = isAdmin
      ? {
          in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as Array<
            'PUBLIC' | 'INTERNAL' | 'RESTRICTED'
          >,
        }
      : { in: ['PUBLIC', 'INTERNAL'] as Array<'PUBLIC' | 'INTERNAL'> };
    const docs = await this.prisma.corpusDocument.findMany({
      where: { id: { in: unique }, ...JURISPRUDENCE_SOURCE, visibility },
      select: { id: true, editorialStatus: true },
    });
    const byId = new Map(docs.map((item) => [item.id, item]));
    return {
      requested: unique.length,
      maxBatchSize: 50,
      results: unique.map((id) => {
        const item = byId.get(id);
        return {
          documentId: id,
          status: !item
            ? 'not_eligible'
            : ['NO_REVIEWED', 'NOT_SELECTED'].includes(item.editorialStatus)
              ? 'would_send_to_review'
              : item.editorialStatus === 'REVIEW_PENDING'
                ? 'already_pending'
                : 'not_eligible',
        };
      }),
    };
  }

  async batchJurisprudenceReview(
    documentIds: string[],
    userId: number,
    isAdmin: boolean,
  ) {
    const preview = await this.previewBatchJurisprudenceReview(
      documentIds,
      isAdmin,
    );
    const eligibleIds = preview.results
      .filter((item) => item.status === 'would_send_to_review')
      .map((item) => item.documentId);
    await this.prisma.$transaction(async (tx) => {
      for (const documentId of eligibleIds) {
        const doc = await tx.corpusDocument.findUniqueOrThrow({
          where: { id: documentId },
          select: { editorialStatus: true, metadata: true },
        });
        const oldMeta =
          doc.metadata &&
          typeof doc.metadata === 'object' &&
          !Array.isArray(doc.metadata)
            ? (doc.metadata as Record<string, Prisma.JsonValue>)
            : {};
        const curation = {
          state: 'REVIEW_PENDING',
          reason: null,
          note: null,
          reviewedBy: userId,
          reviewedAt: new Date().toISOString(),
        };
        await tx.corpusDocument.update({
          where: { id: documentId },
          data: {
            editorialStatus: 'REVIEW_PENDING',
            metadata: { ...oldMeta, jurisprudenceCuration: curation },
          },
        });
        await this.audit(
          tx,
          userId,
          documentId,
          'JURISPRUDENCE_REVIEW_PENDING',
          { editorialStatus: doc.editorialStatus },
          { editorialStatus: 'REVIEW_PENDING', batch: true },
        );
      }
      if (eligibleIds.length)
        await this.audit(
          tx,
          userId,
          null,
          'JURISPRUDENCE_REVIEW_PENDING_BATCH',
          null,
          { documentIds: eligibleIds, count: eligibleIds.length },
        );
    });
    return {
      sent: eligibleIds.length,
      alreadyPending: preview.results.filter(
        (item) => item.status === 'already_pending',
      ).length,
      notEligible: preview.results.filter(
        (item) => item.status === 'not_eligible',
      ).length,
      results: preview.results.map((item) => ({
        ...item,
        status:
          item.status === 'would_send_to_review'
            ? 'sent_to_review'
            : item.status,
      })),
    };
  }

  async setJurisprudence(
    documentId: string,
    status: 'REVIEW_PENDING' | 'SELECTED' | 'NOT_SELECTED',
    reason: string | undefined,
    note: string | undefined,
    userId: number,
    isAdmin: boolean,
  ) {
    if (!['REVIEW_PENDING', 'SELECTED', 'NOT_SELECTED'].includes(status))
      throw new BadRequestException('Estado editorial inválido.');
    const doc = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        ...JURISPRUDENCE_SOURCE,
        visibility: isAdmin
          ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
          : { in: ['PUBLIC', 'INTERNAL'] },
      },
      select: { id: true, editorialStatus: true, metadata: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (
      status === 'REVIEW_PENDING' &&
      !['NO_REVIEWED', 'NOT_SELECTED'].includes(doc.editorialStatus)
    )
      throw new BadRequestException(
        'Sólo un documento nuevo o no seleccionado puede pasar a revisión.',
      );
    if (
      ['SELECTED', 'NOT_SELECTED'].includes(status) &&
      doc.editorialStatus !== 'REVIEW_PENDING'
    )
      throw new BadRequestException(
        'El documento debe estar en revisión antes de decidir su selección.',
      );
    if (status === 'SELECTED') {
      const allowed = [
        'CASO_NOVEDOSO',
        'CRITERIO_AISLADO',
        'CAMBIO_CRITERIO',
        'CONTRADICCION',
        'RELEVANCIA_HISTORICA',
        'TEMA_RELEVANTE',
        'OTRO',
      ];
      if (!reason || !allowed.includes(reason))
        throw new BadRequestException('Indique un motivo válido de selección.');
      if (reason === 'OTRO' && !note?.trim())
        throw new BadRequestException(
          'Describa el motivo cuando elige “Otro”.',
        );
      const approvedLink = await this.prisma.corpusDocumentLink.findFirst({
        where: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          relationship: 'ASSOCIATED_WITH',
        },
      });
      if (!approvedLink)
        throw new BadRequestException(
          'Primero debe revisarse y aprobarse la asociación con una sentencia existente.',
        );
    }
    const oldMeta =
      doc.metadata &&
      typeof doc.metadata === 'object' &&
      !Array.isArray(doc.metadata)
        ? (doc.metadata as Record<string, Prisma.JsonValue>)
        : {};
    const curation = {
      state: status,
      reason: status === 'SELECTED' ? reason : null,
      note: note?.trim() || null,
      reviewedBy: userId,
      reviewedAt: new Date().toISOString(),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocument.update({
        where: { id: documentId },
        data: {
          editorialStatus: status,
          metadata: { ...oldMeta, jurisprudenceCuration: curation },
        },
      });
      await this.audit(
        tx,
        userId,
        documentId,
        `JURISPRUDENCE_${status}`,
        {
          editorialStatus: doc.editorialStatus,
          curation: oldMeta.jurisprudenceCuration ?? null,
        },
        { editorialStatus: status, curation },
      );
    });
    return { documentId, status, reason: curation.reason };
  }

  async collections(isAdmin = false) {
    const allowedVisibility = isAdmin
      ? ['PUBLIC', 'INTERNAL', 'RESTRICTED']
      : ['PUBLIC', 'INTERNAL'];
    return this.prisma.digestoCollection.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            memberships: {
              where: { document: { visibility: { in: allowedVisibility } } },
            },
          },
        },
      },
    });
  }

  async collection(id: string, page = 1) {
    const collection = await this.prisma.digestoCollection.findFirst({
      where: { id, status: 'ACTIVE' },
      select: { id: true, name: true, description: true, status: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada.');
    const safePage = Math.max(1, Math.trunc(page));
    const where = {
      collectionId: id,
      document: {
        ...INSTITUTIONAL,
        visibility: { in: ['INTERNAL', 'PUBLIC'] },
        status: { in: ['INDEXED', 'OCR_REQUIRED'] },
      },
    };
    const [total, memberships] = await Promise.all([
      this.prisma.digestoCollectionMembership.count({ where }),
      this.prisma.digestoCollectionMembership.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (safePage - 1) * 30,
        take: 30,
        select: {
          document: {
            select: {
              id: true,
              title: true,
              court: true,
              chamber: true,
              caseNumber: true,
              decisionDate: true,
            },
          },
        },
      }),
    ]);
    return {
      ...collection,
      total,
      page: safePage,
      pageSize: 30,
      documents: memberships.map((item) => item.document),
    };
  }

  async topics() {
    return this.prisma.digestoTopic.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async tags() {
    return this.prisma.digestoTag.findMany({ orderBy: { name: 'asc' } });
  }

  async createTopic(
    name: string,
    description: string | undefined,
    userId: number,
  ) {
    const normalized = normalize(name);
    if (!normalized) throw new BadRequestException('El nombre es obligatorio.');
    const topic = await this.prisma.digestoTopic.create({
      data: {
        name: name.trim(),
        normalized,
        description: description?.trim() || null,
      },
    });
    await this.audit(this.prisma, userId, null, 'DIGESTO_TOPIC_CREATED', null, {
      topicId: topic.id,
      name: topic.name,
    });
    return topic;
  }

  async createTag(name: string, userId: number) {
    const normalized = normalize(name);
    if (!normalized) throw new BadRequestException('El nombre es obligatorio.');
    const tag = await this.prisma.digestoTag.create({
      data: { name: name.trim(), normalized },
    });
    await this.audit(this.prisma, userId, null, 'DIGESTO_TAG_CREATED', null, {
      tagId: tag.id,
      name: tag.name,
    });
    return tag;
  }

  async addTopic(
    documentId: string,
    topicId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const [document, topic] = await Promise.all([
      this.prisma.corpusDocument.findFirst({
        where: {
          id: documentId,
          ...INSTITUTIONAL,
          visibility: isAdmin
            ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
            : { in: ['PUBLIC', 'INTERNAL'] },
        },
        select: { id: true },
      }),
      this.prisma.digestoTopic.findFirst({
        where: { id: topicId, active: true },
        select: { id: true, name: true },
      }),
    ]);
    if (!document || !topic)
      throw new NotFoundException('Documento o tema no encontrados.');
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentTopic.upsert({
        where: { documentId_topicId: { documentId, topicId } },
        update: {},
        create: { documentId, topicId },
      });
      await this.corpusLink(tx, documentId, 'TOPIC', topicId, 'TAGGED_WITH');
      await this.audit(tx, userId, documentId, 'DIGESTO_TOPIC_ADDED', null, {
        topicId,
        topicName: topic.name,
      });
    });
    return { documentId, topicId, linked: true };
  }

  async removeTopic(
    documentId: string,
    topicId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const document = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        ...INSTITUTIONAL,
        visibility: isAdmin
          ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
          : { in: ['PUBLIC', 'INTERNAL'] },
      },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentTopic.deleteMany({
        where: { documentId, topicId },
      });
      await tx.corpusDocumentLink.deleteMany({
        where: {
          documentId,
          targetDomain: 'DIGESTO',
          targetType: 'TOPIC',
          targetId: topicId,
          relationship: 'TAGGED_WITH',
        },
      });
      await this.audit(
        tx,
        userId,
        documentId,
        'DIGESTO_TOPIC_REMOVED',
        { topicId },
        null,
      );
    });
    return { documentId, topicId, linked: false };
  }

  async addTag(
    documentId: string,
    tagId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const [document, tag] = await Promise.all([
      this.prisma.corpusDocument.findFirst({
        where: {
          id: documentId,
          ...INSTITUTIONAL,
          visibility: isAdmin
            ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
            : { in: ['PUBLIC', 'INTERNAL'] },
        },
        select: { id: true },
      }),
      this.prisma.digestoTag.findUnique({
        where: { id: tagId },
        select: { id: true, name: true },
      }),
    ]);
    if (!document || !tag)
      throw new NotFoundException('Documento o etiqueta no encontrados.');
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentTag.upsert({
        where: { documentId_tagId: { documentId, tagId } },
        update: {},
        create: { documentId, tagId },
      });
      await this.corpusLink(tx, documentId, 'TAG', tagId, 'TAGGED_WITH');
      await this.audit(tx, userId, documentId, 'DIGESTO_TAG_ADDED', null, {
        tagId,
        tagName: tag.name,
      });
    });
    return { documentId, tagId, linked: true };
  }

  async removeTag(
    documentId: string,
    tagId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const document = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        ...INSTITUTIONAL,
        visibility: isAdmin
          ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
          : { in: ['PUBLIC', 'INTERNAL'] },
      },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await this.prisma.$transaction(async (tx) => {
      await tx.corpusDocumentTag.deleteMany({ where: { documentId, tagId } });
      await tx.corpusDocumentLink.deleteMany({
        where: {
          documentId,
          targetDomain: 'DIGESTO',
          targetType: 'TAG',
          targetId: tagId,
          relationship: 'TAGGED_WITH',
        },
      });
      await this.audit(
        tx,
        userId,
        documentId,
        'DIGESTO_TAG_REMOVED',
        { tagId },
        null,
      );
    });
    return { documentId, tagId, linked: false };
  }

  async createCollection(
    name: string,
    description: string | undefined,
    userId: number,
  ) {
    const normalized = normalize(name);
    if (!normalized) throw new BadRequestException('El nombre es obligatorio.');
    const collection = await this.prisma.digestoCollection.create({
      data: {
        name: name.trim(),
        normalized,
        description: description?.trim() || null,
      },
    });
    await this.audit(
      this.prisma,
      userId,
      null,
      'DIGESTO_COLLECTION_CREATED',
      null,
      { collectionId: collection.id, name: collection.name },
    );
    return collection;
  }

  async addToCollection(
    documentId: string,
    collectionId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const [document, collection] = await Promise.all([
      this.prisma.corpusDocument.findFirst({
        where: {
          id: documentId,
          ...INSTITUTIONAL,
          visibility: isAdmin
            ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
            : { in: ['PUBLIC', 'INTERNAL'] },
        },
        select: { id: true },
      }),
      this.prisma.digestoCollection.findFirst({
        where: { id: collectionId, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    ]);
    if (!document || !collection)
      throw new NotFoundException('Documento o colección no encontrados.');
    await this.prisma.$transaction(async (tx) => {
      await tx.digestoCollectionMembership.upsert({
        where: { collectionId_documentId: { collectionId, documentId } },
        update: {},
        create: { collectionId, documentId },
      });
      await tx.corpusDocumentLink.upsert({
        where: {
          documentId_targetDomain_targetType_targetId_relationship: {
            documentId,
            targetDomain: 'DIGESTO',
            targetType: 'COLLECTION',
            targetId: collectionId,
            relationship: 'MEMBER_OF',
          },
        },
        update: {},
        create: {
          documentId,
          targetDomain: 'DIGESTO',
          targetType: 'COLLECTION',
          targetId: collectionId,
          relationship: 'MEMBER_OF',
        },
      });
      await this.audit(
        tx,
        userId,
        documentId,
        'DIGESTO_COLLECTION_ADDED',
        null,
        { collectionId, collectionName: collection.name },
      );
    });
    return { documentId, collectionId, linked: true };
  }

  async removeFromCollection(
    documentId: string,
    collectionId: string,
    userId: number,
    isAdmin: boolean,
  ) {
    const document = await this.prisma.corpusDocument.findFirst({
      where: {
        id: documentId,
        ...INSTITUTIONAL,
        visibility: isAdmin
          ? { in: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] }
          : { in: ['PUBLIC', 'INTERNAL'] },
      },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    await this.prisma.$transaction(async (tx) => {
      await tx.digestoCollectionMembership.deleteMany({
        where: { documentId, collectionId },
      });
      await tx.corpusDocumentLink.deleteMany({
        where: {
          documentId,
          targetDomain: 'DIGESTO',
          targetType: 'COLLECTION',
          targetId: collectionId,
          relationship: 'MEMBER_OF',
        },
      });
      await this.audit(
        tx,
        userId,
        documentId,
        'DIGESTO_COLLECTION_REMOVED',
        { collectionId },
        null,
      );
    });
    return { documentId, collectionId, linked: false };
  }

  private async audit(
    tx: Prisma.TransactionClient | PrismaService,
    userId: number,
    documentId: string | null,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    await tx.accionLog.create({
      data: {
        usuarioId: userId,
        entidad: 'CorpusDocument',
        entidadId: null,
        accion: action,
        descripcion: documentId
          ? `documentId=${documentId}`
          : 'Digesto catalog',
        datosAntes:
          before == null ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
        datosDespues: {
          ...(after && typeof after === 'object' ? after : {}),
          ...(documentId ? { documentId } : {}),
        },
      },
    });
  }

  private validateBatchIds(ids: string[]) {
    if (!Array.isArray(ids))
      throw new BadRequestException('La lista de documentos es obligatoria.');
    const unique = [
      ...new Set(
        ids
          .filter(
            (id): id is string =>
              typeof id === 'string' && id.trim().length > 0,
          )
          .map((id) => id.trim()),
      ),
    ];
    if (!unique.length || unique.length > 50 || unique.length !== ids.length)
      throw new BadRequestException(
        'Seleccione entre 1 y 50 IDs únicos válidos.',
      );
    return unique;
  }

  private async corpusLink(
    tx: Prisma.TransactionClient,
    documentId: string,
    type: string,
    targetId: string,
    relationship: string,
  ) {
    await tx.corpusDocumentLink.upsert({
      where: {
        documentId_targetDomain_targetType_targetId_relationship: {
          documentId,
          targetDomain: 'DIGESTO',
          targetType: type,
          targetId,
          relationship,
        },
      },
      update: {},
      create: {
        documentId,
        targetDomain: 'DIGESTO',
        targetType: type,
        targetId,
        relationship,
      },
    });
  }
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');
}

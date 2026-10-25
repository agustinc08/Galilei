import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionItemsQueryDto } from './dto/collection-items-query.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { UpdateCollectionNoteDto } from './dto/update-collection-note.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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

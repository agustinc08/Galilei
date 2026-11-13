import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';
import { CreateInstitutoJuridicoDto } from './dto/create-instituto-juridico.dto';
import { CreateSinonimoJuridicoDto } from './dto/create-sinonimo-juridico.dto';
import { UpdateInstitutoJuridicoDto } from './dto/update-instituto-juridico.dto';
import { UpdateSinonimoJuridicoDto } from './dto/update-sinonimo-juridico.dto';

export type LegalSearchSuggestion = {
  value: string;
  tipo: 'voz_juridica' | 'termino_relacionado';
  relacion?: string;
};

type ActiveInstituteTerms = {
  nombre: string;
  sinonimos: Array<{ termino: string }>;
};

const SUGGESTION_LIMIT = 12;
const VOCABULARY_CACHE_MS = 30_000;
const SUGGESTION_PRIORITY: Record<LegalSearchSuggestion['tipo'], number> = {
  voz_juridica: 0,
  termino_relacionado: 1,
};

@Injectable()
export class InstitutosJuridicosService {
  private activeTermsCache: ActiveInstituteTerms[] | null = null;
  private activeTermsCacheExpiresAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const data = await this.prisma.institutoJuridico.findMany({
      orderBy: { nombre: 'asc' },
      include: {
        sinonimos: {
          orderBy: { termino: 'asc' },
        },
      },
    });
    return { data };
  }

  async findOne(id: number) {
    const data = await this.prisma.institutoJuridico.findUnique({
      where: { id },
      include: {
        sinonimos: {
          orderBy: { termino: 'asc' },
        },
      },
    });

    if (!data) {
      throw new NotFoundException('Instituto jurídico no encontrado');
    }

    return { data };
  }

  async create(dto: CreateInstitutoJuridicoDto) {
    await this.ensureNombreDisponible(dto.nombre);
    const data = await this.prisma.institutoJuridico.create({ data: dto });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async update(id: number, dto: UpdateInstitutoJuridicoDto) {
    await this.ensureInstitutoExists(id);
    if (dto.nombre) {
      await this.ensureNombreDisponible(dto.nombre, id);
    }
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: dto,
    });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async remove(id: number) {
    await this.ensureInstitutoExists(id);
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: { activo: false },
    });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async findSinonimos(institutoId: number) {
    await this.ensureInstitutoExists(institutoId);
    const data = await this.prisma.sinonimoJuridico.findMany({
      where: { institutoId },
      orderBy: { termino: 'asc' },
    });
    return { data };
  }

  async createSinonimo(institutoId: number, dto: CreateSinonimoJuridicoDto) {
    await this.ensureInstitutoExists(institutoId);
    await this.ensureSinonimoDisponible(institutoId, dto.termino);
    const data = await this.prisma.sinonimoJuridico.create({
      data: { institutoId, termino: dto.termino },
    });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async updateSinonimo(id: number, dto: UpdateSinonimoJuridicoDto) {
    const sinonimo = await this.ensureSinonimoExists(id);
    if (dto.termino) {
      await this.ensureSinonimoDisponible(
        sinonimo.institutoId,
        dto.termino,
        id,
      );
    }
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: dto,
    });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async removeSinonimo(id: number) {
    await this.ensureSinonimoExists(id);
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: { activo: false },
    });
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async searchSuggestions(rawQuery?: string): Promise<LegalSearchSuggestion[]> {
    const query = normalizeSearchText(rawQuery);
    if (query.length < 3) return [];

    const terms = await this.getActiveSearchTerms();
    const suggestions = new Map<string, LegalSearchSuggestion>();
    const add = (suggestion: LegalSearchSuggestion) => {
      const key = normalizeSearchText(suggestion.value);
      if (!key) return;
      const existing = suggestions.get(key);
      if (
        !existing ||
        SUGGESTION_PRIORITY[suggestion.tipo] <
          SUGGESTION_PRIORITY[existing.tipo]
      ) {
        suggestions.set(key, suggestion);
      }
    };

    for (const institute of terms) {
      const voice = institute.nombre.trim();
      const voiceKey = normalizeSearchText(voice);
      const voiceMatches = voiceKey.includes(query);
      const matchingSynonyms = institute.sinonimos.filter((synonym) =>
        normalizeSearchText(synonym.termino).includes(query),
      );
      if (!voiceMatches && !matchingSynonyms.length) continue;

      add({
        value: voice,
        tipo: 'voz_juridica',
      });

      for (const synonym of institute.sinonimos) {
        const value = synonym.termino.trim();
        const valueKey = normalizeSearchText(value);
        if (!valueKey || valueKey === voiceKey) continue;
        const matchesQuery = valueKey.includes(query);
        if (voiceMatches || matchesQuery) {
          add({
            value,
            tipo: 'termino_relacionado',
            relacion: voice,
          });
        }
      }
    }

    return [...suggestions.values()]
      .sort(
        (left, right) =>
          SUGGESTION_PRIORITY[left.tipo] - SUGGESTION_PRIORITY[right.tipo] ||
          left.value.localeCompare(right.value, 'es'),
      )
      .slice(0, SUGGESTION_LIMIT);
  }

  async expandTerms(rawTerms: string[]) {
    const cleaned = rawTerms.map((term) => term.trim()).filter(Boolean);

    if (!cleaned.length) {
      return [];
    }

    const where: Prisma.InstitutoJuridicoWhereInput = {
      activo: true,
      OR: cleaned.flatMap((term) => [
        { nombre: { contains: term, mode: 'insensitive' } },
        {
          sinonimos: {
            some: {
              termino: { contains: term, mode: 'insensitive' },
              activo: true,
            },
          },
        },
      ]),
    };

    const institutos = await this.prisma.institutoJuridico.findMany({
      where,
      include: {
        sinonimos: {
          where: { activo: true },
          select: { termino: true },
        },
      },
    });

    const expanded = new Set<string>();
    for (const instituto of institutos) {
      expanded.add(instituto.nombre);
      for (const sinonimo of instituto.sinonimos) {
        expanded.add(sinonimo.termino);
      }
    }

    return [...expanded].filter((term) => !cleaned.includes(term));
  }

  private async getActiveSearchTerms() {
    if (this.activeTermsCache && this.activeTermsCacheExpiresAt > Date.now()) {
      return this.activeTermsCache;
    }

    const terms = await this.prisma.institutoJuridico.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
      select: {
        nombre: true,
        sinonimos: {
          where: { activo: true },
          orderBy: { termino: 'asc' },
          select: { termino: true },
        },
      },
    });
    this.activeTermsCache = terms;
    this.activeTermsCacheExpiresAt = Date.now() + VOCABULARY_CACHE_MS;
    return terms;
  }

  private invalidateSearchVocabularyCache() {
    this.activeTermsCache = null;
    this.activeTermsCacheExpiresAt = 0;
  }

  private async ensureNombreDisponible(nombre: string, currentId?: number) {
    const existing = await this.prisma.institutoJuridico.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(currentId && { NOT: { id: currentId } }),
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Ya existe un instituto con ese nombre');
    }
  }

  private async ensureSinonimoDisponible(
    institutoId: number,
    termino: string,
    currentId?: number,
  ) {
    const existing = await this.prisma.sinonimoJuridico.findFirst({
      where: {
        institutoId,
        termino: { equals: termino, mode: 'insensitive' },
        ...(currentId && { NOT: { id: currentId } }),
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Ese sinonimo ya existe para el instituto');
    }
  }

  private async ensureInstitutoExists(id: number) {
    const instituto = await this.prisma.institutoJuridico.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!instituto) {
      throw new NotFoundException('Instituto jurídico no encontrado');
    }
    return instituto;
  }

  private async ensureSinonimoExists(id: number) {
    const sinonimo = await this.prisma.sinonimoJuridico.findUnique({
      where: { id },
      select: { id: true, institutoId: true },
    });
    if (!sinonimo) {
      throw new NotFoundException('Sinónimo jurídico no encontrado');
    }
    return sinonimo;
  }
}

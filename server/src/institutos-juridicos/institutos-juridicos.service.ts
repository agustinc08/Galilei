import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoValidacionVocabulario,
  Prisma,
} from '../generated/prisma/client';
import { normalizeSearchText } from '../busqueda/utils/search-normalizer';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInstitutoJuridicoDto } from './dto/create-instituto-juridico.dto';
import { CreateSinonimoJuridicoDto } from './dto/create-sinonimo-juridico.dto';
import { ReviewVocabularyDto } from './dto/review-vocabulary.dto';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  async findAll() {
    const data = await this.prisma.institutoJuridico.findMany({
      orderBy: { nombre: 'asc' },
      include: { sinonimos: { orderBy: { termino: 'asc' } } },
    });
    return { data };
  }

  async findOne(id: number) {
    const data = await this.prisma.institutoJuridico.findUnique({
      where: { id },
      include: { sinonimos: { orderBy: { termino: 'asc' } } },
    });
    if (!data) throw new NotFoundException('Instituto jurídico no encontrado');
    return { data };
  }

  async create(dto: CreateInstitutoJuridicoDto, actorId: number) {
    await this.ensureNombreDisponible(dto.nombre);
    const data = await this.prisma.institutoJuridico.create({
      data: {
        ...dto,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        creadoPorId: actorId,
      },
    });
    await this.audit(
      actorId,
      'InstitutoJuridico',
      data.id,
      'LEGAL_VOCABULARY_CREATE',
      null,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async update(id: number, dto: UpdateInstitutoJuridicoDto, actorId: number) {
    const before = await this.ensureInstitutoExists(id);
    if (dto.nombre) await this.ensureNombreDisponible(dto.nombre, id);
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: {
        ...dto,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        revisadoPorId: null,
        revisadoAt: null,
        observacionRevision: null,
      },
    });
    await this.audit(
      actorId,
      'InstitutoJuridico',
      id,
      'LEGAL_VOCABULARY_UPDATE',
      before,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async remove(id: number, actorId: number) {
    const before = await this.ensureInstitutoExists(id);
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: { activo: false },
    });
    await this.audit(
      actorId,
      'InstitutoJuridico',
      id,
      'LEGAL_VOCABULARY_DISABLE',
      before,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async reviewInstitute(
    id: number,
    dto: ReviewVocabularyDto,
    reviewerId: number,
  ) {
    const before = await this.ensureInstitutoExists(id);
    this.validateDecision(dto);
    if (
      dto.estado === 'APROBADO' &&
      ![before.materia, before.fuente, before.identificadorFuente].every(
        (value) => value?.trim(),
      )
    ) {
      throw new BadRequestException(
        'Para aprobar una voz completá materia, fuente e identificador de procedencia.',
      );
    }
    const estadoValidacion = this.toReviewState(dto.estado);
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: {
        estadoValidacion,
        activo: estadoValidacion === EstadoValidacionVocabulario.APROBADO,
        revisadoPorId: reviewerId,
        revisadoAt: new Date(),
        observacionRevision: dto.observacion?.trim() || null,
      },
    });
    await this.audit(
      reviewerId,
      'InstitutoJuridico',
      id,
      'LEGAL_VOCABULARY_REVIEW',
      before,
      data,
    );
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

  async createSinonimo(
    institutoId: number,
    dto: CreateSinonimoJuridicoDto,
    actorId: number,
  ) {
    await this.ensureInstitutoExists(institutoId);
    await this.ensureSinonimoDisponible(institutoId, dto.termino);
    const data = await this.prisma.sinonimoJuridico.create({
      data: {
        institutoId,
        termino: dto.termino,
        fuente: dto.fuente,
        identificadorFuente: dto.identificadorFuente,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        creadoPorId: actorId,
      },
    });
    await this.audit(
      actorId,
      'SinonimoJuridico',
      data.id,
      'LEGAL_RELATION_CREATE',
      null,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async updateSinonimo(
    id: number,
    dto: UpdateSinonimoJuridicoDto,
    actorId: number,
  ) {
    const before = await this.ensureSinonimoExists(id);
    if (dto.termino) {
      await this.ensureSinonimoDisponible(before.institutoId, dto.termino, id);
    }
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: {
        ...dto,
        activo: false,
        estadoValidacion: EstadoValidacionVocabulario.PENDIENTE_REVISION,
        revisadoPorId: null,
        revisadoAt: null,
        observacionRevision: null,
      },
    });
    await this.audit(
      actorId,
      'SinonimoJuridico',
      id,
      'LEGAL_RELATION_UPDATE',
      before,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async removeSinonimo(id: number, actorId: number) {
    const before = await this.ensureSinonimoExists(id);
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: { activo: false },
    });
    await this.audit(
      actorId,
      'SinonimoJuridico',
      id,
      'LEGAL_RELATION_DISABLE',
      before,
      data,
    );
    this.invalidateSearchVocabularyCache();
    return { data };
  }

  async reviewSinonimo(
    id: number,
    dto: ReviewVocabularyDto,
    reviewerId: number,
  ) {
    const before = await this.ensureSinonimoExists(id);
    this.validateDecision(dto);
    if (
      dto.estado === 'APROBADO' &&
      ![before.fuente, before.identificadorFuente].every((value) =>
        value?.trim(),
      )
    ) {
      throw new BadRequestException(
        'Para aprobar una relación completá fuente e identificador de procedencia.',
      );
    }
    if (
      dto.estado === 'APROBADO' &&
      (before.instituto.estadoValidacion !==
        EstadoValidacionVocabulario.APROBADO ||
        !before.instituto.activo)
    ) {
      throw new BadRequestException(
        'La voz principal debe estar aprobada y activa antes de aprobar una relación.',
      );
    }
    const estadoValidacion = this.toReviewState(dto.estado);
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: {
        estadoValidacion,
        activo: estadoValidacion === EstadoValidacionVocabulario.APROBADO,
        revisadoPorId: reviewerId,
        revisadoAt: new Date(),
        observacionRevision: dto.observacion?.trim() || null,
      },
    });
    await this.audit(
      reviewerId,
      'SinonimoJuridico',
      id,
      'LEGAL_RELATION_REVIEW',
      before,
      data,
    );
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

      add({ value: voice, tipo: 'voz_juridica' });
      for (const synonym of institute.sinonimos) {
        const value = synonym.termino.trim();
        const valueKey = normalizeSearchText(value);
        if (!valueKey || valueKey === voiceKey) continue;
        if (voiceMatches || valueKey.includes(query)) {
          add({ value, tipo: 'termino_relacionado', relacion: voice });
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
    if (!cleaned.length) return [];
    const where: Prisma.InstitutoJuridicoWhereInput = {
      activo: true,
      estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      OR: cleaned.flatMap((term) => [
        { nombre: { contains: term, mode: 'insensitive' } },
        {
          sinonimos: {
            some: {
              termino: { contains: term, mode: 'insensitive' },
              activo: true,
              estadoValidacion: EstadoValidacionVocabulario.APROBADO,
            },
          },
        },
      ]),
    };
    const institutes = await this.prisma.institutoJuridico.findMany({
      where,
      include: {
        sinonimos: {
          where: {
            activo: true,
            estadoValidacion: EstadoValidacionVocabulario.APROBADO,
          },
          select: { termino: true },
        },
      },
    });
    const expanded = new Set<string>();
    for (const institute of institutes) {
      expanded.add(institute.nombre);
      for (const synonym of institute.sinonimos) expanded.add(synonym.termino);
    }
    return [...expanded].filter((term) => !cleaned.includes(term));
  }

  private async getActiveSearchTerms() {
    if (this.activeTermsCache && this.activeTermsCacheExpiresAt > Date.now())
      return this.activeTermsCache;
    const terms = await this.prisma.institutoJuridico.findMany({
      where: {
        activo: true,
        estadoValidacion: EstadoValidacionVocabulario.APROBADO,
      },
      orderBy: { nombre: 'asc' },
      select: {
        nombre: true,
        sinonimos: {
          where: {
            activo: true,
            estadoValidacion: EstadoValidacionVocabulario.APROBADO,
          },
          orderBy: { termino: 'asc' },
          select: { termino: true },
        },
      },
    });
    this.activeTermsCache = terms;
    this.activeTermsCacheExpiresAt = Date.now() + VOCABULARY_CACHE_MS;
    return terms;
  }

  private async ensureNombreDisponible(nombre: string, currentId?: number) {
    const existing = await this.prisma.institutoJuridico.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        ...(currentId && { NOT: { id: currentId } }),
      },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException('Ya existe un instituto con ese nombre');
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
    if (existing)
      throw new BadRequestException('Ese sinónimo ya existe para el instituto');
  }

  private async ensureInstitutoExists(id: number) {
    const institute = await this.prisma.institutoJuridico.findUnique({
      where: { id },
    });
    if (!institute)
      throw new NotFoundException('Instituto jurídico no encontrado');
    return institute;
  }

  private async ensureSinonimoExists(id: number) {
    const synonym = await this.prisma.sinonimoJuridico.findUnique({
      where: { id },
      include: { instituto: true },
    });
    if (!synonym)
      throw new NotFoundException('Sinónimo jurídico no encontrado');
    return synonym;
  }

  private validateDecision(dto: ReviewVocabularyDto) {
    if (dto.estado === 'RECHAZADO' && !dto.observacion?.trim()) {
      throw new BadRequestException('Indicá el motivo del rechazo.');
    }
  }

  private toReviewState(estado: ReviewVocabularyDto['estado']) {
    return estado === 'APROBADO'
      ? EstadoValidacionVocabulario.APROBADO
      : EstadoValidacionVocabulario.RECHAZADO;
  }

  private async audit(
    usuarioId: number,
    entidad: 'InstitutoJuridico' | 'SinonimoJuridico',
    entidadId: number,
    accion: string,
    datosAntes: unknown,
    datosDespues: unknown,
  ) {
    await this.logsService.registrarAccion({
      usuarioId,
      entidad,
      entidadId,
      accion,
      descripcion: 'Cambio registrado en el catálogo jurídico.',
      datosAntes,
      datosDespues,
    });
  }

  private invalidateSearchVocabularyCache() {
    this.activeTermsCache = null;
    this.activeTermsCacheExpiresAt = 0;
  }
}

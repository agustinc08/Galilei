import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInstitutoJuridicoDto } from './dto/create-instituto-juridico.dto';
import { CreateSinonimoJuridicoDto } from './dto/create-sinonimo-juridico.dto';
import { UpdateInstitutoJuridicoDto } from './dto/update-instituto-juridico.dto';
import { UpdateSinonimoJuridicoDto } from './dto/update-sinonimo-juridico.dto';

@Injectable()
export class InstitutosJuridicosService {
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
    return { data };
  }

  async remove(id: number) {
    await this.ensureInstitutoExists(id);
    const data = await this.prisma.institutoJuridico.update({
      where: { id },
      data: { activo: false },
    });
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
    return { data };
  }

  async removeSinonimo(id: number) {
    await this.ensureSinonimoExists(id);
    const data = await this.prisma.sinonimoJuridico.update({
      where: { id },
      data: { activo: false },
    });
    return { data };
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

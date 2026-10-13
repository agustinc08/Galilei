import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, WorkspaceRole, WorkspaceDependencyType } from '@prisma/client';
import path from 'node:path';
import { BusquedaService } from '../busqueda/busqueda.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  BasicDocumentTextExtractor,
  InvalidPdfError,
} from './document-text-extractor';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import type { DocumentStorageAdapter } from './document-storage.adapter';
import { CorpusDocumentAccessService } from './corpus-document-access.service';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const extractor = new BasicDocumentTextExtractor();
export const WORKSPACE_STORAGE_ADAPTER = 'WORKSPACE_STORAGE_ADAPTER';

@Injectable()
export class WorkspaceDocumentService {
  private readonly storage: DocumentStorageAdapter;
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: BusquedaService,
    private readonly documents: CorpusDocumentAccessService,
    @Optional()
    @Inject(WORKSPACE_STORAGE_ADAPTER)
    storage?: DocumentStorageAdapter,
  ) {
    this.storage = storage ?? new LocalDocumentStorageAdapter();
  }

  async mine(user: AuthenticatedUser) {
    const rows = await this.prisma.documentWorkspace.findMany({
      where: {
        active: true,
        members: { some: { userId: user.id, active: true } },
      },
      orderBy: { dependency: { name: 'asc' } },
      select: {
        id: true,
        dependency: { select: { code: true, name: true, type: true } },
        members: {
          where: { userId: user.id, active: true },
          select: { role: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      ...row.dependency,
      role: row.members[0]?.role,
    }));
  }

  async createWorkspace(
    user: AuthenticatedUser,
    input: { code: string; name: string; type: WorkspaceDependencyType },
  ) {
    if (user.rol.nombre !== 'ADMIN') throw new NotFoundException();
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (
      !/^[A-Z0-9][A-Z0-9_-]{1,39}$/u.test(code) ||
      name.length < 2 ||
      name.length > 120
    )
      throw new BadRequestException('Código o nombre inválido.');
    if (!Object.values(WorkspaceDependencyType).includes(input.type))
      throw new BadRequestException('Tipo de dependencia inválido.');
    try {
      const workspace = await this.prisma.$transaction(async (tx) => {
        const dependency = await tx.documentDependency.create({
          data: { code, name, type: input.type },
        });
        const created = await tx.documentWorkspace.create({
          data: { dependencyId: dependency.id },
        });
        await tx.workspaceMembership.create({
          data: {
            workspaceId: created.id,
            userId: user.id,
            role: WorkspaceRole.ADMIN,
          },
        });
        await tx.accionLog.create({
          data: {
            usuarioId: user.id,
            entidad: 'DocumentWorkspace',
            accion: 'CREATE',
            descripcion: 'Creación de espacio documental privado.',
            datosDespues: { workspaceId: created.id, dependencyCode: code },
          },
        });
        return {
          id: created.id,
          code,
          name,
          type: input.type,
          role: WorkspaceRole.ADMIN,
        };
      });
      return workspace;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new BadRequestException(
          'Ya existe una dependencia con ese código.',
        );
      throw error;
    }
  }

  async folders(workspaceId: string, user: AuthenticatedUser) {
    await this.requireMembership(workspaceId, user);
    return this.prisma.workspaceFolder.findMany({
      where: { workspaceId },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        createdAt: true,
        _count: { select: { documents: true, children: true } },
      },
    });
  }

  async createFolder(
    workspaceId: string,
    user: AuthenticatedUser,
    input: { name: string; parentId?: string | null },
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const name = input.name.trim();
    if (!name || name.length > 100 || /[\\/]/u.test(name))
      throw new BadRequestException('Nombre de carpeta inválido.');
    const parentId = input.parentId || null;
    if (
      parentId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: parentId, workspaceId },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    if (
      await this.prisma.workspaceFolder.findFirst({
        where: { workspaceId, parentId, name },
      })
    )
      throw new BadRequestException(
        'Ya existe una carpeta con ese nombre en esta ubicación.',
      );
    const folder = await this.prisma.workspaceFolder.create({
      data: { workspaceId, parentId, name, createdById: user.id },
    });
    await this.audit(user.id, workspaceId, 'FOLDER_CREATE', {
      folderId: folder.id,
      parentId,
    });
    return { id: folder.id, parentId: folder.parentId, name: folder.name };
  }

  async moveDocument(
    workspaceId: string,
    documentId: string,
    user: AuthenticatedUser,
    folderId?: string | null,
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const link = await this.prisma.workspaceDocument.findFirst({
      where: { workspaceId, documentId },
      select: { id: true, folderId: true },
    });
    if (!link) throw new NotFoundException('Documento no encontrado.');
    if (
      folderId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: folderId, workspaceId },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    await this.prisma.workspaceDocument.update({
      where: { id: link.id },
      data: { folderId: folderId || null },
    });
    await this.audit(user.id, workspaceId, 'DOCUMENT_MOVE', {
      documentId,
      fromFolderId: link.folderId,
      toFolderId: folderId || null,
    });
    return { documentId, folderId: folderId || null };
  }

  async members(workspaceId: string, user: AuthenticatedUser) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [WorkspaceRole.ADMIN]);
    return this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      orderBy: [
        { role: 'asc' },
        { user: { apellido: 'asc' } },
        { user: { nombre: 'asc' } },
      ],
      select: {
        userId: true,
        role: true,
        active: true,
        createdAt: true,
        user: { select: { nombre: true, apellido: true, email: true } },
      },
    });
  }

  async documentsInWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    folderId?: string,
  ) {
    await this.requireMembership(workspaceId, user);
    if (
      folderId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: folderId, workspaceId },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    const links = await this.prisma.workspaceDocument.findMany({
      where: { workspaceId, ...(folderId ? { folderId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { nombre: true, apellido: true } },
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            documentType: true,
            createdAt: true,
            files: {
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                originalFilename: true,
                mimeType: true,
                sizeBytes: true,
                sha256: true,
              },
            },
            latestExtraction: {
              select: { status: true, pages: { select: { pageNumber: true } } },
            },
          },
        },
        folder: { select: { id: true, name: true } },
      },
    });
    return links.map(({ document, folder, ...link }) => ({
      ...link,
      document: {
        ...document,
        file: document.files[0]
          ? {
              filename: document.files[0].originalFilename,
              mimeType: document.files[0].mimeType,
              sizeBytes: Number(document.files[0].sizeBytes),
              sha256: document.files[0].sha256,
            }
          : null,
        files: undefined,
        extraction: document.latestExtraction
          ? {
              status: document.latestExtraction.status,
              pageCount: document.latestExtraction.pages.length,
            }
          : null,
        latestExtraction: undefined,
      },
      folder,
    }));
  }

  async upload(
    workspaceId: string,
    user: AuthenticatedUser,
    files: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }>,
    folderId?: string,
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    if (!files?.length || files.length > MAX_FILES)
      throw new BadRequestException(
        `Subí entre 1 y ${MAX_FILES} PDFs por operación.`,
      );
    if (
      folderId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: folderId, workspaceId },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    const results: Array<{
      documentId: string;
      status: string;
      title?: string;
      pageCount?: number;
      duplicate: boolean;
    }> = [];
    for (const file of files)
      results.push(await this.ingestOne(workspaceId, user.id, file, folderId));
    return { results };
  }

  async searchWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    q: string,
    page = 1,
    pageSize = 20,
  ) {
    await this.requireMembership(workspaceId, user);
    if (!q?.trim()) throw new BadRequestException('Ingresá una búsqueda.');
    return this.search.federatedSearch(q, 'AND', {
      visibility: 'ADMIN',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      sourceSystems: ['CORPUS'],
      page,
      pageSize,
      documentScope: { kind: 'WORKSPACE', workspaceId },
    });
  }

  async metadata(
    workspaceId: string,
    id: string,
    user: AuthenticatedUser,
    page?: number,
  ) {
    await this.requireMembership(workspaceId, user);
    return this.documents.metadata(id, 'RESTRICTED', page, workspaceId);
  }
  async matches(
    workspaceId: string,
    id: string,
    user: AuthenticatedUser,
    q: string,
  ) {
    await this.requireMembership(workspaceId, user);
    return this.documents.matches(id, 'RESTRICTED', q, workspaceId);
  }
  async file(workspaceId: string, id: string, user: AuthenticatedUser) {
    await this.requireMembership(workspaceId, user);
    return this.documents.file(id, 'RESTRICTED', workspaceId);
  }

  async manageMember(
    workspaceId: string,
    user: AuthenticatedUser,
    input: { userId: number; role: WorkspaceRole; active?: boolean },
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [WorkspaceRole.ADMIN]);
    if (
      !Number.isInteger(input.userId) ||
      input.userId <= 0 ||
      !Object.values(WorkspaceRole).includes(input.role)
    )
      throw new BadRequestException('Membresía inválida.');
    if (
      !(await this.prisma.usuario.findFirst({
        where: { id: input.userId, activo: true },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Usuario no encontrado.');
    const result = await this.prisma.workspaceMembership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: input.userId } },
      create: {
        workspaceId,
        userId: input.userId,
        role: input.role,
        active: input.active ?? true,
      },
      update: { role: input.role, active: input.active ?? true },
    });
    await this.audit(user.id, workspaceId, 'MEMBER_UPSERT', {
      memberUserId: input.userId,
      role: result.role,
      active: result.active,
    });
    return { userId: result.userId, role: result.role, active: result.active };
  }

  private async ingestOne(
    workspaceId: string,
    userId: number,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    folderId?: string,
  ) {
    const name = path
      .basename(file.originalname)
      .replace(/[\r\n]/gu, '_')
      .slice(0, 255);
    if (
      !name.toLowerCase().endsWith('.pdf') ||
      file.mimetype !== 'application/pdf' ||
      file.size > MAX_FILE_BYTES ||
      file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
    )
      throw new BadRequestException(
        `El archivo ${name || '(sin nombre)'} debe ser PDF válido de hasta 20 MB.`,
      );
    let extraction;
    try {
      extraction = await extractor.extract(
        name,
        'application/pdf',
        file.buffer,
      );
    } catch (error) {
      if (error instanceof InvalidPdfError)
        throw new BadRequestException(`PDF inválido: ${name}`);
      throw error;
    }
    const stored = await this.storage.put(name, file.buffer);
    const existing = await this.prisma.workspaceDocument.findFirst({
      where: {
        workspaceId,
        document: {
          documentScope: 'PRIVATE_WORKSPACE',
          files: { some: { sha256: stored.sha256 } },
        },
      },
      select: {
        documentId: true,
        document: { select: { status: true, title: true } },
      },
    });
    if (existing)
      return {
        documentId: existing.documentId,
        status: existing.document.status,
        duplicate: true,
      };
    const source = await this.prisma.corpusSourceSystem.upsert({
      where: { code: 'WORKSPACE_UPLOAD' },
      create: {
        code: 'WORKSPACE_UPLOAD',
        name: 'Carga de espacio privado',
        sourceType: 'PRIVATE_WORKSPACE',
      },
      update: {},
    });
    const document = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.corpusDocument.create({
        data: {
          documentType: 'PRIVATE_DOCUMENT',
          title: name.replace(/\.pdf$/iu, ''),
          jurisdiction: 'CIVIL',
          visibility: 'RESTRICTED',
          documentScope: 'PRIVATE_WORKSPACE',
          status:
            extraction.status === 'TEXT_EXTRACTED' ? 'INDEXED' : 'OCR_REQUIRED',
          searchText: extraction.text,
        },
      });
      const storedFile = await tx.corpusDocumentFile.create({
        data: {
          documentId: doc.id,
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          sizeBytes: BigInt(stored.sizeBytes),
          originalFilename: name,
          mimeType: 'application/pdf',
          pageCount: extraction.pages.length,
        },
      });
      const extracted = await tx.corpusExtraction.create({
        data: {
          documentId: doc.id,
          fileId: storedFile.id,
          extractor: extraction.extractor,
          extractorVersion: extraction.extractorVersion,
          status: extraction.status,
          text: extraction.text,
          pages: { create: extraction.pages },
        },
      });
      await tx.corpusDocument.update({
        where: { id: doc.id },
        data: { latestExtractionId: extracted.id },
      });
      await tx.corpusIngestionRecord.create({
        data: {
          sourceSystemId: source.id,
          documentId: doc.id,
          fileId: storedFile.id,
          status: doc.status,
          checksum: stored.sha256,
          idempotencyKey: `workspace:${workspaceId}:${stored.sha256}`,
          originalFilename: name,
          metadataOriginal: { source: 'workspace-upload' },
        },
      });
      await tx.workspaceDocument.create({
        data: {
          workspaceId,
          documentId: doc.id,
          folderId: folderId ?? null,
          uploadedById: userId,
        },
      });
      await tx.accionLog.create({
        data: {
          usuarioId: userId,
          entidad: 'WorkspaceDocument',
          accion: 'UPLOAD',
          descripcion: 'PDF incorporado al espacio privado.',
          datosDespues: {
            workspaceId,
            documentId: doc.id,
            sha256: stored.sha256,
            bytes: stored.sizeBytes,
            status: doc.status,
          },
        },
      });
      return {
        id: doc.id,
        status: doc.status,
        title: doc.title,
        pageCount: extraction.pages.length,
      };
    });
    return {
      documentId: document.id,
      status: document.status,
      title: document.title,
      pageCount: document.pageCount,
      duplicate: false,
    };
  }

  private async requireMembership(
    workspaceId: string,
    user: AuthenticatedUser,
  ) {
    const row = await this.prisma.workspaceMembership.findFirst({
      where: {
        workspaceId,
        userId: user.id,
        active: true,
        workspace: { active: true },
      },
      select: { role: true },
    });
    if (!row) throw new NotFoundException('Espacio no encontrado.');
    return row;
  }
  private requireRole(current: WorkspaceRole, allowed: WorkspaceRole[]) {
    if (!allowed.includes(current))
      throw new ForbiddenException('Tu rol no permite esta operación.');
  }
  private audit(
    usuarioId: number,
    workspaceId: string,
    accion: string,
    details: Prisma.InputJsonObject,
  ) {
    return this.prisma.accionLog.create({
      data: {
        usuarioId,
        entidad: 'DocumentWorkspace',
        accion,
        datosDespues: { workspaceId, ...details },
      },
    });
  }
}

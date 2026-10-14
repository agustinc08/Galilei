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
import {
  mimeTypesForCorpusTypes,
  validateCorpusTypes,
  validateSearchDateRange,
} from '../busqueda/utils/search-filters';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  BasicDocumentTextExtractor,
  InvalidPdfError,
  type ExtractionResult,
} from './document-text-extractor';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import type { DocumentStorageAdapter } from './document-storage.adapter';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { normalizeRelativePath } from './document-source-scanner';

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

  async administeredWorkspaces(user: AuthenticatedUser) {
    if (user.rol.nombre !== 'ADMIN') throw new NotFoundException();
    const rows = await this.prisma.documentWorkspace.findMany({
      orderBy: [{ active: 'desc' }, { dependency: { name: 'asc' } }],
      select: {
        id: true,
        active: true,
        dependency: { select: { code: true, name: true, type: true } },
        members: {
          where: { active: true, role: WorkspaceRole.ADMIN },
          select: {
            user: {
              select: { id: true, nombre: true, apellido: true, email: true },
            },
          },
          orderBy: { userId: 'asc' },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      ...row.dependency,
      active: row.active,
      administrators: row.members.map((member) => member.user),
    }));
  }

  async setWorkspaceActive(
    workspaceId: string,
    user: AuthenticatedUser,
    active: boolean,
  ) {
    if (user.rol.nombre !== 'ADMIN') throw new NotFoundException();
    if (typeof active !== 'boolean')
      throw new BadRequestException('Indicá si el espacio debe estar activo.');
    const current = await this.prisma.documentWorkspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        active: true,
        dependency: { select: { name: true } },
      },
    });
    if (!current) throw new NotFoundException('Espacio no encontrado.');
    if (current.active === active) return { id: current.id, active };
    const updated = await this.prisma.documentWorkspace.update({
      where: { id: workspaceId },
      data: { active },
      select: { id: true, active: true },
    });
    await this.prisma.accionLog.create({
      data: {
        usuarioId: user.id,
        entidad: 'DocumentWorkspace',
        accion: active ? 'WORKSPACE_ACTIVATE' : 'WORKSPACE_DEACTIVATE',
        descripcion: active
          ? 'Activación de espacio documental.'
          : 'Desactivación de espacio documental.',
        datosAntes: { workspaceId, active: current.active },
        datosDespues: {
          workspaceId,
          active,
          dependencyName: current.dependency.name,
        },
      },
    });
    return updated;
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

  async renameFolder(
    workspaceId: string,
    folderId: string,
    user: AuthenticatedUser,
    input: { name: string },
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const name = input.name.trim();
    if (!name || name.length > 100 || /[\\/]/u.test(name))
      throw new BadRequestException('Nombre de carpeta inválido.');
    const current = await this.prisma.workspaceFolder.findFirst({
      where: { id: folderId, workspaceId },
      select: { id: true, name: true, parentId: true },
    });
    if (!current) throw new NotFoundException('Carpeta no encontrada.');
    const duplicate = await this.prisma.workspaceFolder.findFirst({
      where: {
        workspaceId,
        parentId: current.parentId,
        name,
        id: { not: folderId },
      },
      select: { id: true },
    });
    if (duplicate)
      throw new BadRequestException(
        'Ya existe una carpeta con ese nombre en esta ubicación.',
      );
    const folder = await this.prisma.workspaceFolder.update({
      where: { id: folderId },
      data: { name },
      select: { id: true, parentId: true, name: true },
    });
    await this.audit(user.id, workspaceId, 'FOLDER_RENAME', {
      folderId,
      previousName: current.name,
      name,
    });
    return folder;
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

  async memberCandidates(
    workspaceId: string,
    user: AuthenticatedUser,
    q: string,
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [WorkspaceRole.ADMIN]);
    const term = q.trim();
    if (term.length < 3) return [];
    return this.prisma.usuario.findMany({
      where: {
        activo: true,
        OR: [
          { nombre: { contains: term, mode: 'insensitive' } },
          { apellido: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      take: 20,
      select: { id: true, nombre: true, apellido: true, email: true },
    });
  }

  async activity(workspaceId: string, user: AuthenticatedUser) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [WorkspaceRole.ADMIN]);
    return this.prisma.$queryRaw<
      Array<{
        id: number;
        accion: string;
        descripcion: string | null;
        createdAt: Date;
        nombre: string;
        apellido: string | null;
      }>
    >`
      SELECT log."id", log."accion", log."descripcion", log."createdAt",
             actor."nombre", actor."apellido"
        FROM "AccionLog" AS log
        JOIN "Usuario" AS actor ON actor."id" = log."usuarioId"
       WHERE log."entidad" = 'DocumentWorkspace'
         AND COALESCE(log."datosDespues"->>'workspaceId', log."datosAntes"->>'workspaceId') = ${workspaceId}
       ORDER BY log."createdAt" DESC
       LIMIT 20
    `;
  }

  async documentsInWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    folderId?: string | null,
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
      where: { workspaceId, ...(folderId !== undefined ? { folderId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
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
        `Subí entre 1 y ${MAX_FILES} archivos PDF o TXT por operación.`,
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
      message?: string;
    }> = [];
    for (const file of files) {
      try {
        results.push(
          await this.ingestOne(workspaceId, user.id, file, folderId),
        );
      } catch (error) {
        results.push({
          documentId: '',
          status: 'ERROR',
          duplicate: false,
          message:
            error instanceof BadRequestException
              ? error.message
              : 'No pudimos procesar este archivo. Podés volver a intentarlo.',
        });
      }
    }
    return { results };
  }

  async ingestFromSource(
    workspaceId: string,
    uploadedById: number,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    replaceDocumentId?: string,
  ) {
    return this.ingestOne(
      workspaceId,
      uploadedById,
      file,
      undefined,
      replaceDocumentId,
    );
  }

  async searchWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    q: string,
    page = 1,
    pageSize = 20,
    folderId?: string | null,
    sourceId?: string,
    sourceFolder?: string,
    filters?: { type?: unknown; dateFrom?: unknown; dateTo?: unknown },
  ): Promise<
    import('../busqueda/adapters/search-source.adapter').SearchResultPage | null
  > {
    await this.requireMembership(workspaceId, user);
    if (!q?.trim()) throw new BadRequestException('Ingresá una búsqueda.');
    if (
      folderId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: folderId, workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    if (sourceFolder && (!sourceId || sourceId === '__manual_upload__'))
      throw new BadRequestException(
        'Elegí una fuente antes de filtrar por su carpeta.',
      );
    if (sourceId && sourceId !== '__manual_upload__') {
      const source = await this.prisma.documentSource.findFirst({
        where: { id: sourceId, workspaceId },
        select: { id: true },
      });
      if (!source) throw new NotFoundException('Fuente no encontrada.');
    }
    let normalizedSourceFolder: string | undefined;
    if (sourceFolder) {
      try {
        normalizedSourceFolder = normalizeRelativePath(sourceFolder);
      } catch {
        throw new BadRequestException('La carpeta de fuente no es válida.');
      }
    }
    const dateRange = validateSearchDateRange(
      filters?.dateFrom,
      filters?.dateTo,
    );
    const types = validateCorpusTypes(filters?.type);
    const result = await this.search.federatedSearch(q, 'AND', {
      visibility: 'ADMIN',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      sourceSystems: ['CORPUS'],
      page,
      pageSize,
      ...(dateRange.dateFrom || dateRange.dateTo || types
        ? {
            filters: {
              ...dateRange,
              ...(types ? { types } : {}),
            },
          }
        : {}),
      documentScope: {
        kind: 'WORKSPACE',
        workspaceId,
        ...(folderId !== undefined ? { folderId } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(normalizedSourceFolder
          ? { sourceFolder: normalizedSourceFolder }
          : {}),
      },
    });
    if (!result?.results?.length) return result;
    const links = await this.prisma.workspaceDocument.findMany({
      where: {
        workspaceId,
        documentId: { in: result.results.map((item) => item.sourceId) },
      },
      select: {
        documentId: true,
        createdAt: true,
        folder: { select: { id: true, name: true } },
        document: { select: { status: true } },
      },
    });
    const sourceFiles = await this.prisma.sourceFile.findMany({
      where: {
        documentId: { in: result.results.map((item) => item.sourceId) },
        source: { workspaceId },
      },
      select: {
        documentId: true,
        sourceId: true,
        relativePath: true,
        status: true,
        source: { select: { name: true } },
      },
    });
    const metadataById = new Map(links.map((link) => [link.documentId, link]));
    const sourceFilesByDocument = new Map<string, typeof sourceFiles>();
    for (const sourceFile of sourceFiles) {
      if (!sourceFile.documentId) continue;
      const rows = sourceFilesByDocument.get(sourceFile.documentId) ?? [];
      rows.push(sourceFile);
      sourceFilesByDocument.set(sourceFile.documentId, rows);
    }
    return {
      ...result,
      results: result.results.map((item) => {
        const link = metadataById.get(item.sourceId);
        return {
          ...item,
          metadata: {
            ...item.metadata,
            folderId: link?.folder?.id ?? null,
            folderName: link?.folder?.name ?? 'Todos los documentos',
            uploadedAt: link?.createdAt.toISOString() ?? null,
            status: link?.document.status ?? null,
            sourceName:
              [
                ...new Set(
                  (sourceFilesByDocument.get(item.sourceId) ?? [])
                    .filter((row) => !sourceId || row.sourceId === sourceId)
                    .map((row) => row.source.name),
                ),
              ].join(', ') || 'Carga manual',
            sourceStatus: (() => {
              const rows = (
                sourceFilesByDocument.get(item.sourceId) ?? []
              ).filter((row) => !sourceId || row.sourceId === sourceId);
              return rows.length > 0 &&
                rows.every((row) => row.status === 'MISSING')
                ? 'MISSING'
                : rows.length > 0
                  ? 'PRESENT'
                  : 'MANUAL';
            })(),
            sourceFolder: (() => {
              const rows = sourceFilesByDocument.get(item.sourceId) ?? [];
              const preferred =
                rows.find((row) => row.sourceId === sourceId) ?? rows[0];
              if (!preferred) return null;
              const segments = preferred.relativePath.split(/[\\/]/u);
              return segments.length > 1
                ? segments.slice(0, -1).join('\\')
                : null;
            })(),
          },
        };
      }),
    };
  }

  async searchSources(workspaceId: string, user: AuthenticatedUser) {
    await this.requireMembership(workspaceId, user);
    const [sources, manualUploadCount] = await Promise.all([
      this.prisma.documentSource.findMany({
        where: { workspaceId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          enabled: true,
          _count: { select: { files: true } },
        },
      }),
      this.prisma.workspaceDocument.count({
        where: {
          workspaceId,
          document: {
            documentScope: 'PRIVATE_WORKSPACE',
            sourceFiles: {
              none: { source: { workspaceId } },
            },
          },
        },
      }),
    ]);
    return [
      {
        id: '__manual_upload__',
        name: 'Carga manual',
        type: 'MANUAL_UPLOAD',
        status: 'CONNECTED',
        enabled: true,
        fileCount: manualUploadCount,
      },
      ...sources.map(({ _count, ...source }) => ({
        ...source,
        fileCount: _count.files,
      })),
    ];
  }

  async searchSourceFolders(
    workspaceId: string,
    sourceId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireMembership(workspaceId, user);
    const source = await this.prisma.documentSource.findFirst({
      where: { id: sourceId, workspaceId },
      select: { id: true },
    });
    if (!source) throw new NotFoundException('Fuente no encontrada.');
    const files = await this.prisma.sourceFile.findMany({
      where: { sourceId, documentId: { not: null } },
      select: { relativePath: true },
      orderBy: { normalizedPath: 'asc' },
    });
    const directories = new Map<
      string,
      {
        path: string;
        parentPath: string | null;
        name: string;
        fileCount: number;
      }
    >();
    for (const file of files) {
      const segments = file.relativePath.split(/[\\/]/u);
      if (segments.length < 2) continue;
      let parentPath = '';
      for (const segment of segments.slice(0, -1)) {
        parentPath = parentPath ? `${parentPath}\\${segment}` : segment;
        let normalized: string;
        try {
          normalized = normalizeRelativePath(parentPath);
        } catch {
          break;
        }
        const parent = normalized.includes('\\')
          ? normalized.slice(0, normalized.lastIndexOf('\\'))
          : null;
        const current = directories.get(normalized);
        directories.set(normalized, {
          path: normalized,
          parentPath: parent,
          name: segment,
          fileCount: (current?.fileCount ?? 0) + 1,
        });
      }
    }
    const sortedFolders = [...directories.values()].sort((a, b) =>
      a.path.localeCompare(b.path, 'en'),
    );
    return {
      folders: sortedFolders.slice(0, 5000),
      truncated: sortedFolders.length > 5000,
    };
  }

  async searchNames(
    workspaceId: string,
    user: AuthenticatedUser,
    q: string,
    folderId?: string | null,
    page = 1,
    pageSize = 20,
    sourceId?: string,
    sourceFolder?: string,
    filters?: { type?: unknown; dateFrom?: unknown; dateTo?: unknown },
  ) {
    await this.requireMembership(workspaceId, user);
    const term = q.trim();
    if (term.length < 2)
      throw new BadRequestException('Ingresá al menos dos caracteres.');
    if (
      folderId &&
      !(await this.prisma.workspaceFolder.findFirst({
        where: { id: folderId, workspaceId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Carpeta no encontrada.');
    if (sourceFolder && (!sourceId || sourceId === '__manual_upload__'))
      throw new BadRequestException(
        'Elegí una fuente antes de filtrar por su carpeta.',
      );
    if (sourceId && sourceId !== '__manual_upload__') {
      const source = await this.prisma.documentSource.findFirst({
        where: { id: sourceId, workspaceId },
        select: { id: true },
      });
      if (!source) throw new NotFoundException('Fuente no encontrada.');
    }
    let normalizedSourceFolder: string | undefined;
    if (sourceFolder) {
      try {
        normalizedSourceFolder = normalizeRelativePath(sourceFolder);
      } catch {
        throw new BadRequestException('La carpeta de fuente no es válida.');
      }
    }
    const dateRange = validateSearchDateRange(
      filters?.dateFrom,
      filters?.dateTo,
    );
    const types = validateCorpusTypes(filters?.type);
    const escaped = term.replace(/[\\%_]/gu, (value) => `\\${value}`);
    const namePattern = `%${escaped}%`;
    const predicates: Prisma.Sql[] = [
      Prisma.sql`workspaceDocument."workspaceId" = ${workspaceId}`,
      Prisma.sql`document."documentScope" = 'PRIVATE_WORKSPACE'`,
      Prisma.sql`(document."title" ILIKE ${namePattern} ESCAPE E'\\\\' OR latestFile."originalFilename" ILIKE ${namePattern} ESCAPE E'\\\\')`,
    ];
    if (folderId !== undefined) {
      predicates.push(
        folderId === null
          ? Prisma.sql`workspaceDocument."folderId" IS NULL`
          : Prisma.sql`workspaceDocument."folderId" = ${folderId}`,
      );
    }
    if (sourceId === '__manual_upload__') {
      predicates.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "SourceFile" sourceFile
        JOIN "DocumentSource" source ON source."id" = sourceFile."sourceId"
        WHERE sourceFile."documentId" = document."id"
          AND source."workspaceId" = ${workspaceId}
      )`);
    } else if (sourceId) {
      predicates.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "SourceFile" sourceFile
        JOIN "DocumentSource" source ON source."id" = sourceFile."sourceId"
        WHERE sourceFile."documentId" = document."id"
          AND sourceFile."sourceId" = ${sourceId}
          AND source."workspaceId" = ${workspaceId}
          ${
            normalizedSourceFolder
              ? Prisma.sql`AND (
                sourceFile."normalizedPath" = ${normalizedSourceFolder}
                OR (
                  left(sourceFile."normalizedPath", char_length(${normalizedSourceFolder})) = ${normalizedSourceFolder}
                  AND substring(sourceFile."normalizedPath" from char_length(${normalizedSourceFolder}) + 1 for 1) = E'\\\\'
                )
              )`
              : Prisma.empty
          }
      )`);
    }
    if (types) {
      predicates.push(
        Prisma.sql`lower(btrim(split_part(latestFile."mimeType", ';', 1))) IN (${Prisma.join(mimeTypesForCorpusTypes(types))})`,
      );
    }
    if (dateRange.dateFrom) {
      predicates.push(
        Prisma.sql`document."decisionDate" >= ${dateRange.dateFrom}::date`,
      );
    }
    if (dateRange.dateTo) {
      predicates.push(
        Prisma.sql`document."decisionDate" < (${dateRange.dateTo}::date + INTERVAL '1 day')`,
      );
    }
    const where = Prisma.join(predicates, ' AND ');
    const from = Prisma.sql`
      FROM "WorkspaceDocument" workspaceDocument
      JOIN "CorpusDocument" document ON document."id" = workspaceDocument."documentId"
      LEFT JOIN "WorkspaceFolder" folder ON folder."id" = workspaceDocument."folderId"
      LEFT JOIN LATERAL (
        SELECT file."originalFilename", file."mimeType"
          FROM "CorpusDocumentFile" file
         WHERE file."documentId" = document."id"
         ORDER BY file."version" DESC
         LIMIT 1
      ) latestFile ON TRUE
      WHERE ${where}
    `;
    const safePage = Math.max(1, Math.trunc(page));
    const safePageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    const [countRows, links] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT count(*)::bigint AS "total" ${from}`,
      ),
      this.prisma.$queryRaw<
        Array<{
          documentId: string;
          title: string;
          status: string;
          filename: string | null;
          mimeType: string | null;
          uploadedAt: Date;
          folderId: string | null;
          folderName: string | null;
        }>
      >(Prisma.sql`
        SELECT workspaceDocument."documentId" AS "documentId",
               document."title" AS "title",
               document."status" AS "status",
               latestFile."originalFilename" AS "filename",
               latestFile."mimeType" AS "mimeType",
               workspaceDocument."createdAt" AS "uploadedAt",
               folder."id" AS "folderId",
               folder."name" AS "folderName"
          ${from}
         ORDER BY workspaceDocument."createdAt" DESC
         LIMIT ${safePageSize} OFFSET ${(safePage - 1) * safePageSize}
      `),
    ]);
    const total = Number(countRows[0]?.total ?? 0n);
    return {
      total,
      totalExact: true,
      page: safePage,
      pageSize: safePageSize,
      results: links.map((link) => ({
        documentId: link.documentId,
        title: link.title,
        filename: link.filename ?? link.title,
        mimeType: link.mimeType,
        status: link.status,
        uploadedAt: link.uploadedAt,
        folder:
          link.folderId && link.folderName
            ? { id: link.folderId, name: link.folderName }
            : null,
      })),
    };
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
    const existing = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: input.userId } },
      select: { role: true, active: true },
    });
    const removesAdmin =
      existing?.active &&
      existing.role === WorkspaceRole.ADMIN &&
      ((input.active ?? true) === false || input.role !== WorkspaceRole.ADMIN);
    if (removesAdmin) {
      const activeAdmins = await this.prisma.workspaceMembership.count({
        where: { workspaceId, active: true, role: WorkspaceRole.ADMIN },
      });
      if (activeAdmins <= 1)
        throw new BadRequestException(
          'El espacio debe conservar al menos un administrador activo.',
        );
    }
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
    replaceDocumentId?: string,
  ) {
    const name = path
      .basename(file.originalname)
      .replace(/[\r\n]/gu, '_')
      .slice(0, 255);
    const isPdf =
      name.toLowerCase().endsWith('.pdf') &&
      file.mimetype === 'application/pdf' &&
      file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    const isTxt =
      name.toLowerCase().endsWith('.txt') &&
      file.mimetype.split(';', 1)[0].trim().toLowerCase() === 'text/plain';
    if ((!isPdf && !isTxt) || file.size > MAX_FILE_BYTES)
      throw new BadRequestException(
        `El archivo ${name || '(sin nombre)'} debe ser PDF o TXT válido de hasta 20 MB.`,
      );
    let extraction: ExtractionResult;
    try {
      extraction = await extractor.extract(
        name,
        isPdf ? 'application/pdf' : 'text/plain',
        file.buffer,
      );
    } catch (error) {
      if (error instanceof InvalidPdfError)
        throw new BadRequestException(`PDF inválido: ${name}`);
      throw error;
    }
    const stored = await this.storage.put(name, file.buffer);
    if (
      replaceDocumentId &&
      !(await this.prisma.workspaceDocument.findFirst({
        where: {
          workspaceId,
          documentId: replaceDocumentId,
          document: { documentScope: 'PRIVATE_WORKSPACE' },
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException(
        'Documento de fuente no encontrado en el espacio.',
      );
    const existing = await this.prisma.workspaceDocument.findFirst({
      where: {
        workspaceId,
        ...(replaceDocumentId
          ? { documentId: { not: replaceDocumentId } }
          : {}),
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
      const documentData = {
        documentType: 'PRIVATE_DOCUMENT',
        title: name.replace(/\.(?:pdf|txt)$/iu, ''),
        jurisdiction: 'CIVIL',
        visibility: 'RESTRICTED',
        documentScope: 'PRIVATE_WORKSPACE' as const,
        status:
          extraction.status === 'TEXT_EXTRACTED' ? 'INDEXED' : 'OCR_REQUIRED',
        searchText: extraction.text,
      };
      const doc = replaceDocumentId
        ? await tx.corpusDocument.update({
            where: { id: replaceDocumentId },
            data: documentData,
          })
        : await tx.corpusDocument.create({ data: documentData });
      const priorFile = await tx.corpusDocumentFile.findUnique({
        where: {
          documentId_sha256: { documentId: doc.id, sha256: stored.sha256 },
        },
      });
      const currentVersion = await tx.corpusDocumentFile.aggregate({
        where: { documentId: doc.id },
        _max: { version: true },
      });
      const storedFile = priorFile
        ? await tx.corpusDocumentFile.update({
            where: { id: priorFile.id },
            data: {
              storageKey: stored.storageKey,
              originalFilename: name,
              pageCount: extraction.pages.length,
            },
          })
        : await tx.corpusDocumentFile.create({
            data: {
              documentId: doc.id,
              storageKey: stored.storageKey,
              sha256: stored.sha256,
              sizeBytes: BigInt(stored.sizeBytes),
              originalFilename: name,
              mimeType: isPdf ? 'application/pdf' : 'text/plain',
              pageCount: extraction.pages.length,
              version: (currentVersion._max.version ?? 0) + 1,
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
      const idempotencyKey = replaceDocumentId
        ? `workspace-source:${workspaceId}:${doc.id}:${stored.sha256}`
        : `workspace:${workspaceId}:${stored.sha256}`;
      await tx.corpusIngestionRecord.upsert({
        where: { idempotencyKey },
        update: {
          sourceSystemId: source.id,
          documentId: doc.id,
          fileId: storedFile.id,
          status: doc.status,
          checksum: stored.sha256,
          idempotencyKey,
          originalFilename: name,
          metadataOriginal: {
            source: replaceDocumentId ? 'workspace-source' : 'workspace-upload',
          },
        },
        create: {
          sourceSystemId: source.id,
          documentId: doc.id,
          fileId: storedFile.id,
          status: doc.status,
          checksum: stored.sha256,
          idempotencyKey,
          originalFilename: name,
          metadataOriginal: {
            source: replaceDocumentId ? 'workspace-source' : 'workspace-upload',
          },
        },
      });
      if (!replaceDocumentId)
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
          accion: replaceDocumentId ? 'SOURCE_REPROCESS' : 'UPLOAD',
          descripcion: replaceDocumentId
            ? 'Versión de fuente documental actualizada.'
            : 'PDF incorporado al espacio privado.',
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

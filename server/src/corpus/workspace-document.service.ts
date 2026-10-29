import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  Prisma,
  WorkspaceRole,
  WorkspaceDependencyType,
  WorkspaceVisibilityScope,
} from '../generated/prisma/client';
import path from 'node:path';
import { BusquedaService } from '../busqueda/busqueda.service';
import type { SearchResultPage } from '../busqueda/adapters/search-source.adapter';
import {
  mimeTypesForCorpusTypes,
  validateCorpusTypes,
  validateSearchDateRange,
} from '../busqueda/utils/search-filters';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  BasicDocumentTextExtractor,
  DocumentExtractionError,
  extractionProvenance,
  InvalidPdfError,
  type ExtractionResult,
} from './document-text-extractor';
import { LocalDocumentStorageAdapter } from './document-storage.adapter';
import type { DocumentStorageAdapter } from './document-storage.adapter';
import { CorpusDocumentAccessService } from './corpus-document-access.service';
import { normalizeRelativePath } from './document-source-scanner';
import { LocalPdfOcrProcessor } from './document-local-processors';
import { enqueueLocalOcrJob } from './ocr-job-queue';
import { personalFolderUploadIssue } from './personal-folder-upload-policy';
import { obtenerPdfsReales } from '../archivos/pdf-real.util';
import {
  canReadWorkspaceDocument,
  readableFolderIds,
  workspaceVisibilityLabel,
} from './workspace-document-acl';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const extractor = new BasicDocumentTextExtractor();
export const WORKSPACE_STORAGE_ADAPTER = 'WORKSPACE_STORAGE_ADAPTER';

type WorkspaceDocumentListItem = {
  documentId: string;
  canMakePersonal: boolean;
  [key: string]: unknown;
};

type WorkspaceDocumentListPage = {
  page: number;
  pageSize: number;
  total: number;
  results: WorkspaceDocumentListItem[];
};

type WorkspaceDocumentSearchCoverage = {
  textAvailableDocuments: number;
  ocrRequiredDocuments: number;
  otherUnavailableDocuments: number;
};

@Injectable()
export class WorkspaceDocumentService {
  private readonly storage: DocumentStorageAdapter;
  private readonly ocrProcessor: LocalPdfOcrProcessor;
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: BusquedaService,
    private readonly documents: CorpusDocumentAccessService,
    @Optional()
    @Inject(WORKSPACE_STORAGE_ADAPTER)
    storage?: DocumentStorageAdapter,
    @Optional()
    @Inject(LocalPdfOcrProcessor)
    ocrProcessor?: LocalPdfOcrProcessor,
  ) {
    this.storage = storage ?? new LocalDocumentStorageAdapter();
    this.ocrProcessor = ocrProcessor ?? new LocalPdfOcrProcessor();
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
    const membership = await this.requireMembership(workspaceId, user);
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    const [folders, links] = await Promise.all([
      this.prisma.workspaceFolder.findMany({
        where: { workspaceId, id: { in: readableIds } },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          parentId: true,
          name: true,
          visibilityScope: true,
          createdById: true,
          createdAt: true,
        },
      }),
      this.prisma.workspaceDocument.findMany({
        where: {
          workspaceId,
          OR: [{ folderId: null }, { folderId: { in: readableIds } }],
        },
        select: { folderId: true },
      }),
    ]);
    const documentsByFolder = new Map<string, number>();
    for (const link of links) {
      if (link.folderId)
        documentsByFolder.set(
          link.folderId,
          (documentsByFolder.get(link.folderId) ?? 0) + 1,
        );
    }
    const visibleFolderIds = new Set(folders.map((folder) => folder.id));
    const childrenByFolder = new Map<string, number>();
    for (const folder of folders) {
      if (folder.parentId && visibleFolderIds.has(folder.parentId))
        childrenByFolder.set(
          folder.parentId,
          (childrenByFolder.get(folder.parentId) ?? 0) + 1,
        );
    }
    return Promise.all(
      folders.map(async (folder) => {
        const effectiveScope = await this.effectiveFolderScope(folder.id);
        const authorizedCount =
          effectiveScope === WorkspaceVisibilityScope.RESTRICTED
            ? await this.effectiveRestrictedGrantCount(folder.id)
            : undefined;
        return {
          id: folder.id,
          parentId: folder.parentId,
          name: folder.name,
          createdAt: folder.createdAt,
          visibilityScope: folder.visibilityScope,
          effectiveVisibilityScope: effectiveScope,
          visibilityLabel: workspaceVisibilityLabel(effectiveScope),
          ...(authorizedCount !== undefined ? { authorizedCount } : {}),
          canManageAccess:
            membership.role === WorkspaceRole.ADMIN ||
            (membership.role === WorkspaceRole.EDITOR &&
              folder.createdById === user.id),
          _count: {
            documents: documentsByFolder.get(folder.id) ?? 0,
            children: childrenByFolder.get(folder.id) ?? 0,
          },
        };
      }),
    );
  }

  async createFolder(
    workspaceId: string,
    user: AuthenticatedUser,
    input: {
      name: string;
      parentId?: string | null;
      visibilityScope?: WorkspaceVisibilityScope;
      userIds?: number[];
    },
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
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    let parentScope: WorkspaceVisibilityScope | null = null;
    if (parentId) {
      if (!readableIds.includes(parentId))
        throw new NotFoundException('Carpeta no encontrada.');
      parentScope = await this.effectiveFolderScope(parentId);
    }
    const visibilityScope =
      input.visibilityScope ??
      (parentId
        ? WorkspaceVisibilityScope.INHERIT
        : WorkspaceVisibilityScope.DEPENDENCY_SHARED);
    const workspaceScopes: WorkspaceVisibilityScope[] = [
      WorkspaceVisibilityScope.INHERIT,
      WorkspaceVisibilityScope.DEPENDENCY_SHARED,
      WorkspaceVisibilityScope.RESTRICTED,
    ];
    if (
      !workspaceScopes.includes(visibilityScope) ||
      (!parentId && visibilityScope === WorkspaceVisibilityScope.INHERIT)
    )
      throw new BadRequestException('Elegí un alcance válido para la carpeta.');
    if (visibilityScope === WorkspaceVisibilityScope.RESTRICTED)
      this.requireRole(membership.role, [
        WorkspaceRole.ADMIN,
        WorkspaceRole.EDITOR,
      ]);
    if (
      parentScope === WorkspaceVisibilityScope.RESTRICTED &&
      visibilityScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED
    )
      throw new BadRequestException(
        'Esta carpeta está dentro de una carpeta restringida. Para ampliar el acceso, cambiá primero el acceso de la carpeta superior.',
      );
    if (
      await this.prisma.workspaceFolder.findFirst({
        where: { workspaceId, parentId, name },
      })
    )
      throw new BadRequestException(
        'Ya existe una carpeta con ese nombre en esta ubicación.',
      );
    const selectedMemberships =
      visibilityScope === WorkspaceVisibilityScope.RESTRICTED
        ? await this.selectedMemberships(workspaceId, input.userIds ?? [])
        : [];
    const folder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspaceFolder.create({
        data: {
          workspaceId,
          parentId,
          name,
          visibilityScope,
          createdById: user.id,
        },
      });
      if (selectedMemberships.length)
        await tx.workspaceFolderGrant.createMany({
          data: selectedMemberships.map((membershipId) => ({
            folderId: created.id,
            membershipId,
          })),
        });
      await tx.accionLog.create({
        data: {
          usuarioId: user.id,
          entidad: 'WorkspaceFolder',
          entidadId: null,
          accion:
            visibilityScope === WorkspaceVisibilityScope.RESTRICTED
              ? 'RESTRICTED_FOLDER_CREATE'
              : 'FOLDER_CREATE',
          descripcion: 'Creación de carpeta documental.',
          datosDespues: {
            workspaceId,
            folderId: created.id,
            parentId,
            visibilityScope,
            authorizedMembershipIds: selectedMemberships,
          },
        },
      });
      return created;
    });
    return {
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
      visibilityScope: folder.visibilityScope,
      visibilityLabel: workspaceVisibilityLabel(folder.visibilityScope),
    };
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
    if (membership.role !== WorkspaceRole.ADMIN) {
      const readableIds = await readableFolderIds(this.prisma, {
        kind: 'WORKSPACE',
        workspaceId,
        userId: user.id,
      });
      if (!readableIds.includes(folderId))
        throw new NotFoundException('Carpeta no encontrada.');
    }
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

  async deleteFolder(
    workspaceId: string,
    folderId: string,
    user: AuthenticatedUser,
    reason: string,
  ) {
    const normalizedReason = validateDeletionReason(reason);
    return this.prisma.$transaction(
      async (tx) => {
        const membership = await tx.workspaceMembership.findFirst({
          where: {
            workspaceId,
            userId: user.id,
            active: true,
            workspace: { active: true },
          },
          select: { role: true },
        });
        if (!membership) throw new NotFoundException('Espacio no encontrado.');
        this.requireRole(membership.role, [
          WorkspaceRole.ADMIN,
          WorkspaceRole.EDITOR,
        ]);
        const folder = await tx.workspaceFolder.findFirst({
          where: { id: folderId, workspaceId, ownerUserId: null },
          select: {
            id: true,
            name: true,
            parentId: true,
            createdById: true,
            _count: { select: { documents: true, children: true } },
          },
        });
        if (!folder) throw new NotFoundException('Carpeta no encontrada.');
        if (membership.role !== WorkspaceRole.ADMIN) {
          const readableIds = await readableFolderIds(tx, {
            kind: 'WORKSPACE',
            workspaceId,
            userId: user.id,
          });
          if (!readableIds.includes(folderId))
            throw new NotFoundException('Carpeta no encontrada.');
        }
        if (folder._count.documents || folder._count.children)
          throw new ConflictException(
            'La carpeta debe estar vacía y sin subcarpetas para eliminarla.',
          );
        await tx.workspaceFolder.delete({ where: { id: folder.id } });
        await tx.accionLog.create({
          data: {
            usuarioId: user.id,
            entidad: 'WorkspaceFolder',
            entidadId: null,
            accion: 'WORKSPACE_FOLDER_DELETE',
            descripcion: 'Eliminación de carpeta vacía de Workspace.',
            datosAntes: {
              workspaceId,
              folderId: folder.id,
              parentId: folder.parentId,
              name: folder.name,
            },
            datosDespues: {
              workspaceId,
              folderId: folder.id,
              normalizedReason,
            },
          },
        });
        return { deleted: true, folderId: folder.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deleteDocument(
    workspaceId: string,
    documentId: string,
    user: AuthenticatedUser,
    reason: string,
  ) {
    const normalizedReason = validateDeletionReason(reason);
    return this.prisma.$transaction(
      async (tx) => {
        const membership = await tx.workspaceMembership.findFirst({
          where: {
            workspaceId,
            userId: user.id,
            active: true,
            workspace: { active: true },
          },
          select: { role: true },
        });
        if (!membership) throw new NotFoundException('Espacio no encontrado.');
        this.requireRole(membership.role, [
          WorkspaceRole.ADMIN,
          WorkspaceRole.EDITOR,
        ]);
        const link = await tx.workspaceDocument.findFirst({
          where: { workspaceId, documentId, ownerUserId: null },
          select: {
            id: true,
            folderId: true,
            document: {
              select: {
                id: true,
                documentScope: true,
                files: {
                  select: {
                    storageProvider: true,
                    storageKey: true,
                  },
                },
                _count: {
                  select: {
                    workspaceDocuments: true,
                    links: true,
                    locations: true,
                    associations: true,
                    classifications: true,
                    digestoCollections: true,
                    digestoTopics: true,
                    digestoTags: true,
                    sourceFiles: true,
                    importRunItems: true,
                    institutionalIngestions: true,
                    ocrReviews: true,
                  },
                },
              },
            },
          },
        });
        if (!link) throw new NotFoundException('Documento no encontrado.');
        if (
          membership.role !== WorkspaceRole.ADMIN &&
          !(await canReadWorkspaceDocument(tx, documentId, {
            kind: 'WORKSPACE',
            workspaceId,
            userId: user.id,
          }))
        )
          throw new NotFoundException('Documento no encontrado.');

        const counts = link.document._count;
        const hasNoExternalCorpusRelations =
          link.document.documentScope === 'PRIVATE_WORKSPACE' &&
          counts.workspaceDocuments === 1 &&
          counts.links === 0 &&
          counts.locations === 0 &&
          counts.associations === 0 &&
          counts.classifications === 0 &&
          counts.digestoCollections === 0 &&
          counts.digestoTopics === 0 &&
          counts.digestoTags === 0 &&
          counts.sourceFiles === 0 &&
          counts.importRunItems === 0 &&
          counts.institutionalIngestions === 0 &&
          counts.ocrReviews === 0;
        const extractionApprovalCount = hasNoExternalCorpusRelations
          ? await tx.ocrHumanReviewApproval.count({
              where: { extraction: { documentId } },
            })
          : 0;
        const canDeleteCorpusDocument =
          hasNoExternalCorpusRelations && extractionApprovalCount === 0;
        const blobReferenceStats = await Promise.all(
          link.document.files.map(async (file) => {
            const where = {
              storageProvider: file.storageProvider,
              storageKey: file.storageKey,
            };
            const [before, otherDocuments] = await Promise.all([
              tx.corpusDocumentFile.count({ where }),
              tx.corpusDocumentFile.count({
                where: { ...where, documentId: { not: documentId } },
              }),
            ]);
            return {
              before,
              after: canDeleteCorpusDocument ? otherDocuments : before,
              shared: otherDocuments > 0,
              orphanCandidate: canDeleteCorpusDocument && otherDocuments === 0,
            };
          }),
        );
        const sharedBlobCount = blobReferenceStats.filter(
          (item) => item.shared,
        ).length;
        const orphanCandidateCount = blobReferenceStats.filter(
          (item) => item.orphanCandidate,
        ).length;
        const blobReferenceCountBefore = blobReferenceStats.reduce(
          (total, item) => total + item.before,
          0,
        );
        const blobReferenceCountAfter = blobReferenceStats.reduce(
          (total, item) => total + item.after,
          0,
        );

        if (canDeleteCorpusDocument) {
          // CorpusDocument's cascades are intentionally limited to its private
          // upload pipeline. External/provenance relations above disqualify it.
          await tx.corpusDocument.delete({ where: { id: documentId } });
        } else {
          await tx.workspaceDocument.delete({ where: { id: link.id } });
        }
        await tx.accionLog.create({
          data: {
            usuarioId: user.id,
            entidad: 'WorkspaceDocument',
            entidadId: null,
            accion: 'WORKSPACE_DOCUMENT_DELETE',
            descripcion: 'Eliminación de documento del espacio de trabajo.',
            datosAntes: {
              workspaceId,
              workspaceDocumentId: link.id,
              documentId,
              folderId: link.folderId,
            },
            datosDespues: {
              workspaceId,
              workspaceDocumentId: link.id,
              documentId,
              normalizedReason,
              corpusDocumentDeleted: canDeleteCorpusDocument,
              physicalBlobsDeleted: false,
              sharedBlobCount,
              orphanCandidateCount,
              blobReferenceCountBefore,
              blobReferenceCountAfter,
              extractionApprovalCount,
            },
          },
        });
        return {
          deleted: true,
          workspaceDocumentId: link.id,
          documentId,
          corpusDocumentDeleted: canDeleteCorpusDocument,
          physicalBlobsDeleted: 0,
          sharedBlobsPreserved: sharedBlobCount,
          orphanBlobCandidatesPreserved: orphanCandidateCount,
          blobReferenceCountBefore,
          blobReferenceCountAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async deletePersonalDocument(
    documentId: string,
    user: AuthenticatedUser,
    reason: string,
  ) {
    const normalizedReason = validateDeletionReason(reason);
    return this.prisma.$transaction(
      async (tx) => {
        const link = await tx.workspaceDocument.findFirst({
          where: { workspaceId: null, ownerUserId: user.id, documentId },
          select: {
            id: true,
            folderId: true,
            document: {
              select: {
                id: true,
                documentScope: true,
                files: {
                  select: {
                    storageProvider: true,
                    storageKey: true,
                  },
                },
                _count: {
                  select: {
                    workspaceDocuments: true,
                    links: true,
                    locations: true,
                    associations: true,
                    classifications: true,
                    digestoCollections: true,
                    digestoTopics: true,
                    digestoTags: true,
                    sourceFiles: true,
                    importRunItems: true,
                    institutionalIngestions: true,
                    ocrReviews: true,
                  },
                },
              },
            },
          },
        });
        if (!link) throw new NotFoundException('Documento no encontrado.');

        const counts = link.document._count;
        const hasNoExternalCorpusRelations =
          link.document.documentScope === 'PRIVATE_WORKSPACE' &&
          counts.workspaceDocuments === 1 &&
          counts.links === 0 &&
          counts.locations === 0 &&
          counts.associations === 0 &&
          counts.classifications === 0 &&
          counts.digestoCollections === 0 &&
          counts.digestoTopics === 0 &&
          counts.digestoTags === 0 &&
          counts.sourceFiles === 0 &&
          counts.importRunItems === 0 &&
          counts.institutionalIngestions === 0 &&
          counts.ocrReviews === 0;
        const extractionApprovalCount = hasNoExternalCorpusRelations
          ? await tx.ocrHumanReviewApproval.count({
              where: { extraction: { documentId } },
            })
          : 0;
        const canDeleteCorpusDocument =
          hasNoExternalCorpusRelations && extractionApprovalCount === 0;
        const blobReferenceStats = await Promise.all(
          link.document.files.map(async (file) => {
            const where = {
              storageProvider: file.storageProvider,
              storageKey: file.storageKey,
            };
            const [before, otherDocuments] = await Promise.all([
              tx.corpusDocumentFile.count({ where }),
              tx.corpusDocumentFile.count({
                where: { ...where, documentId: { not: documentId } },
              }),
            ]);
            return {
              before,
              after: canDeleteCorpusDocument ? otherDocuments : before,
              shared: otherDocuments > 0,
              orphanCandidate: canDeleteCorpusDocument && otherDocuments === 0,
            };
          }),
        );
        const sharedBlobCount = blobReferenceStats.filter(
          (item) => item.shared,
        ).length;
        const orphanCandidateCount = blobReferenceStats.filter(
          (item) => item.orphanCandidate,
        ).length;
        const blobReferenceCountBefore = blobReferenceStats.reduce(
          (total, item) => total + item.before,
          0,
        );
        const blobReferenceCountAfter = blobReferenceStats.reduce(
          (total, item) => total + item.after,
          0,
        );

        if (canDeleteCorpusDocument) {
          await tx.corpusDocument.delete({ where: { id: documentId } });
        } else {
          await tx.workspaceDocument.delete({ where: { id: link.id } });
        }
        await tx.accionLog.create({
          data: {
            usuarioId: user.id,
            entidad: 'PersonalDocument',
            entidadId: null,
            accion: 'PERSONAL_DOCUMENT_DELETE',
            descripcion: 'Eliminación de documento personal.',
            datosAntes: {
              workspaceDocumentId: link.id,
              documentId,
              folderId: link.folderId,
              ownerUserId: user.id,
            },
            datosDespues: {
              workspaceDocumentId: link.id,
              documentId,
              normalizedReason,
              corpusDocumentDeleted: canDeleteCorpusDocument,
              physicalBlobsDeleted: false,
              sharedBlobCount,
              orphanCandidateCount,
              blobReferenceCountBefore,
              blobReferenceCountAfter,
              extractionApprovalCount,
            },
          },
        });
        return {
          deleted: true,
          workspaceDocumentId: link.id,
          documentId,
          corpusDocumentDeleted: canDeleteCorpusDocument,
          physicalBlobsDeleted: 0,
          sharedBlobsPreserved: sharedBlobCount,
          orphanBlobCandidatesPreserved: orphanCandidateCount,
          blobReferenceCountBefore,
          blobReferenceCountAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async attachPublishedJudgment(
    workspaceId: string,
    sentenceId: number,
    user: AuthenticatedUser,
    input: { folderId?: string | null; reason: string },
  ) {
    const normalizedReason = validateDeletionReason(input.reason);
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const folderId = input.folderId || null;
    if (folderId) {
      const readableIds = await readableFolderIds(this.prisma, {
        kind: 'WORKSPACE',
        workspaceId,
        userId: user.id,
      });
      if (!readableIds.includes(folderId))
        throw new NotFoundException('Carpeta no encontrada.');
    }

    const sentence = await this.prisma.sentencia.findFirst({
      where: {
        id: sentenceId,
        publicado: true,
        activo: true,
        estadoCarga: 'PUBLICADA',
      },
      select: {
        id: true,
        numeroSentencia: true,
        archivosPdf: {
          select: { id: true, rutaArchivo: true },
        },
      },
    });
    if (!sentence)
      throw new NotFoundException('Fallo publicado no encontrado.');
    const realPdfPaths = new Set(
      obtenerPdfsReales(sentence.archivosPdf).map((pdf) =>
        path.resolve(pdf.rutaArchivo),
      ),
    );
    if (!realPdfPaths.size)
      throw new NotFoundException('El fallo publicado no tiene PDF real.');
    const storageRoot = this.storage.root;
    if (!storageRoot)
      throw new ServiceUnavailableException(
        'No está disponible el almacenamiento local verificado.',
      );

    const links = await this.prisma.corpusDocumentLink.findMany({
      where: {
        targetDomain: 'JURISPRUDENCIA',
        targetType: 'SENTENCIA',
        targetId: String(sentenceId),
        relationship: 'ASSOCIATED_WITH',
        document: {
          documentScope: 'GENERAL',
          // An exact PDF linked to a published judgment may remain INTERNAL
          // when its Corpus record was ingested after the judgment publish
          // event. Keep its stored visibility; Workspace access remains
          // membership and ACL scoped.
          visibility: { in: ['PUBLIC', 'INTERNAL'] },
          status: { in: ['INDEXED', 'OCR_REQUIRED'] },
        },
      },
      select: {
        document: {
          select: {
            id: true,
            files: {
              orderBy: { version: 'desc' },
              take: 1,
              select: {
                id: true,
                storageProvider: true,
                storageKey: true,
                originalFilename: true,
                mimeType: true,
                sizeBytes: true,
                sha256: true,
              },
            },
          },
        },
      },
    });
    const sources = links.flatMap(({ document }) => {
      const file = document.files[0];
      if (
        !file ||
        file.storageProvider !== 'LOCAL_DEV' ||
        file.mimeType.split(';', 1)[0]?.trim().toLowerCase() !==
          'application/pdf' ||
        !realPdfPaths.has(path.resolve(storageRoot, file.storageKey))
      )
        return [];
      return [{ documentId: document.id, file }];
    });
    if (sources.length !== 1)
      throw new NotFoundException(
        'No hay una asociación PDF ↔ fallo publicada inequívoca.',
      );
    const source = sources[0];
    const content = await this.storage.get(source.file.storageKey);
    const checksum = createHash('sha256').update(content).digest('hex');
    if (
      BigInt(content.byteLength) !== source.file.sizeBytes ||
      checksum !== source.file.sha256
    )
      throw new ServiceUnavailableException(
        'El PDF vinculado no pasó la verificación de integridad.',
      );

    return this.prisma.$transaction(
      async (tx) => {
        const currentMembership = await tx.workspaceMembership.findFirst({
          where: {
            workspaceId,
            userId: user.id,
            active: true,
            workspace: { active: true },
          },
          select: { role: true },
        });
        if (!currentMembership)
          throw new NotFoundException('Espacio no encontrado.');
        this.requireRole(currentMembership.role, [
          WorkspaceRole.ADMIN,
          WorkspaceRole.EDITOR,
        ]);
        if (folderId) {
          const readableIds = await readableFolderIds(tx, {
            kind: 'WORKSPACE',
            workspaceId,
            userId: user.id,
          });
          if (!readableIds.includes(folderId))
            throw new NotFoundException('Carpeta no encontrada.');
        }
        const currentSentence = await tx.sentencia.findFirst({
          where: {
            id: sentenceId,
            publicado: true,
            activo: true,
            estadoCarga: 'PUBLICADA',
          },
          select: { id: true },
        });
        const currentSource = await tx.corpusDocumentLink.findFirst({
          where: {
            documentId: source.documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: String(sentenceId),
            relationship: 'ASSOCIATED_WITH',
            document: {
              documentScope: 'GENERAL',
              visibility: { in: ['PUBLIC', 'INTERNAL'] },
              status: { in: ['INDEXED', 'OCR_REQUIRED'] },
            },
          },
          select: {
            document: {
              select: {
                files: {
                  where: { id: source.file.id },
                  select: { id: true },
                },
              },
            },
          },
        });
        if (!currentSentence || !currentSource?.document.files.length)
          throw new NotFoundException('El fallo dejó de estar publicado.');
        if (
          await tx.workspaceDocument.findFirst({
            where: {
              workspaceId,
              ownerUserId: null,
              documentId: source.documentId,
            },
            select: { id: true },
          })
        )
          throw new ConflictException('El fallo ya está vinculado al espacio.');
        const created = await tx.workspaceDocument.create({
          data: {
            workspaceId,
            ownerUserId: null,
            documentId: source.documentId,
            folderId,
            uploadedById: user.id,
          },
          select: { id: true },
        });
        await tx.accionLog.create({
          data: {
            usuarioId: user.id,
            entidad: 'WorkspaceDocument',
            entidadId: null,
            accion: 'WORKSPACE_JURISPRUDENCIA_ATTACH',
            descripcion: 'Vinculación de fallo publicado a Workspace.',
            datosDespues: {
              workspaceId,
              workspaceDocumentId: created.id,
              documentId: source.documentId,
              sentenceId,
              sentenceNumber: sentence.numeroSentencia,
              folderId,
              normalizedReason,
              blobReused: true,
              sha256: source.file.sha256,
            },
          },
        });
        return {
          workspaceDocumentId: created.id,
          documentId: source.documentId,
          sentenceId,
          folderId,
          blobReused: true,
          sha256: source.file.sha256,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async moveDocument(
    workspaceId: string,
    documentId: string,
    user: AuthenticatedUser,
    folderId?: string | null,
    confirmVisibilityChange = false,
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const link = await this.prisma.workspaceDocument.findFirst({
      where: { workspaceId, documentId, ownerUserId: null },
      select: {
        id: true,
        folderId: true,
        document: {
          select: { sourceFiles: { select: { id: true }, take: 1 } },
        },
      },
    });
    if (!link) throw new NotFoundException('Documento no encontrado.');
    if (
      membership.role !== WorkspaceRole.ADMIN &&
      !(await this.documents.canReadWorkspaceDocument(
        documentId,
        workspaceId,
        user.id,
      ))
    )
      throw new NotFoundException('Documento no encontrado.');
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
      throw new NotFoundException('Carpeta no encontrada.');
    if (link.document.sourceFiles.length && folderId) {
      const targetScope = await this.effectiveFolderScope(folderId);
      if (targetScope !== WorkspaceVisibilityScope.DEPENDENCY_SHARED)
        throw new ForbiddenException(
          'Los documentos sincronizados de una carpeta de red se mantienen compartidos con la dependencia.',
        );
    }
    const fromScope = link.folderId
      ? await this.effectiveFolderScope(link.folderId)
      : WorkspaceVisibilityScope.DEPENDENCY_SHARED;
    const toScope = folderId
      ? await this.effectiveFolderScope(folderId)
      : WorkspaceVisibilityScope.DEPENDENCY_SHARED;
    const changesRestrictedAudience =
      link.folderId !== (folderId || null) &&
      (fromScope === WorkspaceVisibilityScope.RESTRICTED ||
        toScope === WorkspaceVisibilityScope.RESTRICTED);
    if (
      (fromScope !== toScope || changesRestrictedAudience) &&
      !confirmVisibilityChange
    )
      throw new BadRequestException(
        toScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED
          ? 'Este cambio ampliará el acceso a todos los integrantes autorizados de la dependencia. Confirmá el cambio para continuar.'
          : toScope === WorkspaceVisibilityScope.RESTRICTED
            ? 'Este cambio limitará o cambiará el acceso a las personas autorizadas en la carpeta de destino. Confirmá el cambio para continuar.'
            : 'Este cambio modifica quién puede ver el documento.',
      );
    if (
      toScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED &&
      fromScope !== WorkspaceVisibilityScope.DEPENDENCY_SHARED &&
      membership.role !== WorkspaceRole.ADMIN
    )
      throw new ForbiddenException(
        'Sólo una persona responsable puede ampliar el acceso a toda la dependencia.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceDocument.update({
        where: { id: link.id },
        data: { folderId: folderId || null },
      });
      await tx.accionLog.create({
        data: {
          usuarioId: user.id,
          entidad: 'WorkspaceDocument',
          entidadId: null,
          accion: 'DOCUMENT_MOVE',
          descripcion: 'Documento movido entre carpetas.',
          datosAntes: {
            workspaceId,
            folderId: link.folderId,
            visibilityScope: fromScope,
          },
          datosDespues: {
            workspaceId,
            folderId: folderId || null,
            visibilityScope: toScope,
          },
        },
      });
    });
    return { documentId, folderId: folderId || null };
  }

  async members(workspaceId: string, user: AuthenticatedUser) {
    await this.requireWorkspaceManagementAdmin(workspaceId, user);
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
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const term = q.trim();
    if (term.length < 3) return [];
    return this.prisma.usuario.findMany({
      where: {
        activo: true,
        workspaceMemberships: { some: { workspaceId, active: true } },
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

  async membershipCandidates(
    workspaceId: string,
    user: AuthenticatedUser,
    q: string,
  ) {
    await this.requireWorkspaceManagementAdmin(workspaceId, user);
    const term = q.trim();
    if (term.length < 3) return [];
    return this.prisma.usuario.findMany({
      where: {
        activo: true,
        workspaceMemberships: { none: { workspaceId, active: true } },
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

  async setRestrictedFolderMembers(
    workspaceId: string,
    folderId: string,
    user: AuthenticatedUser,
    input: {
      userIds?: number[];
      visibilityScope?: WorkspaceVisibilityScope;
      confirmAccessChange?: boolean;
    },
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    const folder = await this.prisma.workspaceFolder.findFirst({
      where: {
        id: folderId,
        workspaceId,
        visibilityScope: {
          in: [
            WorkspaceVisibilityScope.RESTRICTED,
            WorkspaceVisibilityScope.DEPENDENCY_SHARED,
            WorkspaceVisibilityScope.INHERIT,
          ],
        },
      },
      select: {
        id: true,
        parentId: true,
        name: true,
        createdById: true,
        visibilityScope: true,
      },
    });
    if (!folder) throw new NotFoundException('Carpeta no encontrada.');
    if (
      membership.role !== WorkspaceRole.ADMIN &&
      !(
        membership.role === WorkspaceRole.EDITOR &&
        folder.createdById === user.id
      )
    )
      throw new NotFoundException('Carpeta no encontrada.');
    const nextScope = input.visibilityScope ?? folder.visibilityScope;
    if (
      nextScope !== WorkspaceVisibilityScope.RESTRICTED &&
      nextScope !== WorkspaceVisibilityScope.DEPENDENCY_SHARED
    )
      throw new BadRequestException(
        'Una carpeta de la dependencia puede ser compartida o restringida.',
      );
    if (
      nextScope !== folder.visibilityScope &&
      input.confirmAccessChange !== true
    )
      throw new BadRequestException(
        nextScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED
          ? 'Al cambiar a compartida, todos los integrantes autorizados de la dependencia podrán verla. Confirmá para continuar.'
          : 'Al restringir esta carpeta, sólo las personas seleccionadas y responsables de la dependencia podrán verla. Confirmá para continuar.',
      );
    if (
      nextScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED &&
      folder.parentId &&
      (await this.effectiveFolderScope(folder.parentId)) ===
        WorkspaceVisibilityScope.RESTRICTED
    )
      throw new BadRequestException(
        'Esta carpeta está dentro de una carpeta restringida. Para ampliar el acceso, cambiá primero el acceso de la carpeta superior.',
      );
    const existing = await this.prisma.workspaceFolderGrant.findMany({
      where: { folderId },
      select: { membershipId: true },
    });
    const selectedMemberships =
      nextScope !== WorkspaceVisibilityScope.RESTRICTED
        ? []
        : input.userIds !== undefined
          ? await this.selectedMemberships(workspaceId, input.userIds)
          : folder.visibilityScope === WorkspaceVisibilityScope.RESTRICTED
            ? existing.map((row) => row.membershipId)
            : [];
    if (
      nextScope === WorkspaceVisibilityScope.DEPENDENCY_SHARED &&
      membership.role !== WorkspaceRole.ADMIN
    )
      throw new ForbiddenException(
        'Sólo una persona responsable puede compartir una carpeta con toda la dependencia.',
      );
    const existingIds = existing.map((row) => row.membershipId);
    const added = selectedMemberships.filter((id) => !existingIds.includes(id));
    const removed = existingIds.filter(
      (id) => !selectedMemberships.includes(id),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceFolderGrant.deleteMany({ where: { folderId } });
      await tx.workspaceFolder.update({
        where: { id: folderId },
        data: { visibilityScope: nextScope },
      });
      if (selectedMemberships.length)
        await tx.workspaceFolderGrant.createMany({
          data: selectedMemberships.map((membershipId) => ({
            folderId,
            membershipId,
          })),
        });
      await tx.accionLog.create({
        data: {
          usuarioId: user.id,
          entidad: 'WorkspaceFolder',
          entidadId: null,
          accion:
            nextScope === WorkspaceVisibilityScope.RESTRICTED
              ? 'RESTRICTED_FOLDER_ACCESS_CHANGED'
              : 'FOLDER_VISIBILITY_CHANGED',
          descripcion:
            'Actualización de personas autorizadas para una carpeta.',
          datosAntes: { workspaceId, folderId, membershipIds: existingIds },
          datosDespues: {
            workspaceId,
            folderId,
            visibilityScope: nextScope,
            membershipIds: selectedMemberships,
          },
        },
      });
    });
    return {
      folderId,
      visibilityScope: nextScope,
      visibilityLabel: workspaceVisibilityLabel(nextScope),
      authorizedCount: selectedMemberships.length,
      added,
      removed,
    };
  }

  private async selectedMemberships(workspaceId: string, userIds: number[]) {
    if (
      !Array.isArray(userIds) ||
      userIds.length > 100 ||
      userIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new BadRequestException(
        'Seleccioná hasta 100 integrantes de la dependencia.',
      );
    const distinctIds = [...new Set(userIds)];
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        userId: { in: distinctIds },
        active: true,
        workspace: { active: true },
        user: { activo: true },
      },
      select: { id: true, userId: true },
    });
    if (memberships.length !== distinctIds.length)
      throw new BadRequestException(
        'Elegí sólo personas activas de esta dependencia.',
      );
    return memberships.map((membership) => membership.id);
  }

  private async effectiveFolderScope(folderId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ scope: WorkspaceVisibilityScope }>
    >(Prisma.sql`
      WITH RECURSIVE folder_chain AS (
        SELECT folder."id", folder."parentId", folder."workspaceId", folder."ownerUserId",
               folder."visibilityScope", 0 AS depth
          FROM "WorkspaceFolder" folder WHERE folder."id" = ${folderId}
        UNION ALL
        SELECT parent."id", parent."parentId", parent."workspaceId", parent."ownerUserId",
               parent."visibilityScope", chain.depth + 1
          FROM folder_chain chain
          JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
         WHERE parent."workspaceId" IS NOT DISTINCT FROM chain."workspaceId"
           AND parent."ownerUserId" IS NOT DISTINCT FROM chain."ownerUserId"
      )
      SELECT chain."visibilityScope" AS scope
        FROM folder_chain chain
       WHERE chain."visibilityScope" <> 'INHERIT'
       ORDER BY chain.depth ASC
       LIMIT 1
    `);
    return rows[0]?.scope ?? WorkspaceVisibilityScope.DEPENDENCY_SHARED;
  }

  private async effectiveRestrictedGrantCount(folderId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`
      WITH RECURSIVE folder_chain AS (
        SELECT folder."id", folder."parentId", folder."workspaceId", folder."ownerUserId",
               folder."visibilityScope", 0 AS depth
          FROM "WorkspaceFolder" folder WHERE folder."id" = ${folderId}
        UNION ALL
        SELECT parent."id", parent."parentId", parent."workspaceId", parent."ownerUserId",
               parent."visibilityScope", chain.depth + 1
          FROM folder_chain chain
          JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
         WHERE parent."workspaceId" IS NOT DISTINCT FROM chain."workspaceId"
           AND parent."ownerUserId" IS NOT DISTINCT FROM chain."ownerUserId"
      ), restricted_anchor AS (
        SELECT chain."id" FROM folder_chain chain
         WHERE chain."visibilityScope" = 'RESTRICTED'
         ORDER BY chain.depth ASC LIMIT 1
      )
      SELECT count(*)::bigint AS count
        FROM "WorkspaceFolderGrant" grant_row
        JOIN "WorkspaceMembership" membership ON membership."id" = grant_row."membershipId"
       WHERE grant_row."folderId" = (SELECT "id" FROM restricted_anchor)
         AND membership."active" = TRUE
    `);
    return Number(rows[0]?.count ?? 0n);
  }

  async restrictedFolderMembers(
    workspaceId: string,
    folderId: string,
    user: AuthenticatedUser,
  ) {
    const membership = await this.requireMembership(workspaceId, user);
    const folder = await this.prisma.workspaceFolder.findFirst({
      where: {
        id: folderId,
        workspaceId,
        visibilityScope: WorkspaceVisibilityScope.RESTRICTED,
      },
      select: { id: true, createdById: true },
    });
    if (!folder) throw new NotFoundException('Carpeta no encontrada.');
    if (
      membership.role !== WorkspaceRole.ADMIN &&
      !(
        membership.role === WorkspaceRole.EDITOR &&
        folder.createdById === user.id
      )
    )
      throw new NotFoundException('Carpeta no encontrada.');
    const rows = await this.prisma.workspaceFolderGrant.findMany({
      where: { folderId, membership: { active: true } },
      orderBy: [
        { membership: { user: { apellido: 'asc' } } },
        { membership: { user: { nombre: 'asc' } } },
      ],
      select: {
        membership: {
          select: {
            userId: true,
            user: { select: { nombre: true, apellido: true } },
          },
        },
      },
    });
    return rows.map(({ membership: grant }) => ({
      userId: grant.userId,
      nombre: grant.user.nombre,
      apellido: grant.user.apellido,
    }));
  }

  async activity(workspaceId: string, user: AuthenticatedUser) {
    if (user.rol.nombre === 'ADMIN') {
      await this.requireWorkspaceManagementAdmin(workspaceId, user);
    } else {
      const membership = await this.requireMembership(workspaceId, user);
      this.requireRole(membership.role, [
        WorkspaceRole.ADMIN,
        WorkspaceRole.EDITOR,
      ]);
    }
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

  async personalFolders(user: AuthenticatedUser) {
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'PERSONAL',
      userId: user.id,
    });
    const [folders, links] = await Promise.all([
      this.prisma.workspaceFolder.findMany({
        where: {
          workspaceId: null,
          ownerUserId: user.id,
          id: { in: readableIds },
        },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          parentId: true,
          name: true,
          visibilityScope: true,
          createdAt: true,
        },
      }),
      this.prisma.workspaceDocument.findMany({
        where: {
          workspaceId: null,
          ownerUserId: user.id,
          folderId: { in: readableIds },
        },
        select: { folderId: true },
      }),
    ]);
    const documentsByFolder = new Map<string, number>();
    for (const link of links) {
      if (link.folderId)
        documentsByFolder.set(
          link.folderId,
          (documentsByFolder.get(link.folderId) ?? 0) + 1,
        );
    }
    const childrenByFolder = new Map<string, number>();
    const visibleIds = new Set(folders.map((folder) => folder.id));
    for (const folder of folders) {
      if (folder.parentId && visibleIds.has(folder.parentId))
        childrenByFolder.set(
          folder.parentId,
          (childrenByFolder.get(folder.parentId) ?? 0) + 1,
        );
    }
    return folders.map((folder) => ({
      ...folder,
      visibilityLabel: workspaceVisibilityLabel(folder.visibilityScope),
      _count: {
        documents: documentsByFolder.get(folder.id) ?? 0,
        children: childrenByFolder.get(folder.id) ?? 0,
      },
    }));
  }

  async createPersonalFolder(
    user: AuthenticatedUser,
    input: { name: string; parentId?: string | null },
  ) {
    const name = input.name.trim();
    if (!name || name.length > 100 || /[\\/]/u.test(name))
      throw new BadRequestException('Nombre de carpeta inválido.');
    const parentId = input.parentId || null;
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'PERSONAL',
      userId: user.id,
    });
    if (parentId && !readableIds.includes(parentId))
      throw new NotFoundException('Carpeta no encontrada.');
    if (
      await this.prisma.workspaceFolder.findFirst({
        where: { workspaceId: null, ownerUserId: user.id, parentId, name },
        select: { id: true },
      })
    )
      throw new BadRequestException(
        'Ya existe una carpeta con ese nombre en esta ubicación.',
      );
    const folder = await this.prisma.workspaceFolder.create({
      data: {
        workspaceId: null,
        ownerUserId: user.id,
        parentId,
        name,
        visibilityScope: parentId
          ? WorkspaceVisibilityScope.INHERIT
          : WorkspaceVisibilityScope.PERSONAL,
        createdById: user.id,
      },
    });
    await this.prisma.accionLog.create({
      data: {
        usuarioId: user.id,
        entidad: 'WorkspaceFolder',
        entidadId: null,
        accion: 'PERSONAL_FOLDER_CREATE',
        descripcion: 'Creación de carpeta personal.',
        datosDespues: { folderId: folder.id, parentId },
      },
    });
    return {
      id: folder.id,
      parentId,
      name: folder.name,
      visibilityLabel: 'Privado',
    };
  }

  async renamePersonalFolder(
    folderId: string,
    user: AuthenticatedUser,
    input: { name: string },
  ) {
    const name = input.name.trim();
    if (!name || name.length > 100 || /[\\/]/u.test(name))
      throw new BadRequestException('Nombre de carpeta inválido.');
    const folder = await this.prisma.workspaceFolder.findFirst({
      where: { id: folderId, workspaceId: null, ownerUserId: user.id },
      select: { id: true, parentId: true, name: true },
    });
    if (!folder) throw new NotFoundException('Carpeta no encontrada.');
    if (
      await this.prisma.workspaceFolder.findFirst({
        where: {
          id: { not: folderId },
          workspaceId: null,
          ownerUserId: user.id,
          parentId: folder.parentId,
          name,
        },
        select: { id: true },
      })
    )
      throw new BadRequestException(
        'Ya existe una carpeta con ese nombre en esta ubicación.',
      );
    const updated = await this.prisma.workspaceFolder.update({
      where: { id: folderId },
      data: { name },
      select: { id: true, parentId: true, name: true },
    });
    await this.prisma.accionLog.create({
      data: {
        usuarioId: user.id,
        entidad: 'WorkspaceFolder',
        entidadId: null,
        accion: 'PERSONAL_FOLDER_RENAME',
        descripcion: 'Renombrado de carpeta personal.',
        datosAntes: { folderId, name: folder.name },
        datosDespues: { folderId, name },
      },
    });
    return { ...updated, visibilityLabel: 'Privado' };
  }

  async personalDocuments(
    user: AuthenticatedUser,
    folderId: string | null = null,
  ) {
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'PERSONAL',
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
      throw new NotFoundException('Carpeta no encontrada.');
    const links = await this.prisma.workspaceDocument.findMany({
      where: { workspaceId: null, ownerUserId: user.id, folderId },
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
      folder: folder ? { ...folder, visibilityLabel: 'Privado' } : null,
      visibilityLabel: 'Privado',
    }));
  }

  async uploadPersonal(
    user: AuthenticatedUser,
    files: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }>,
    folderId?: string,
    folderUploadPolicy = false,
  ) {
    if (!files?.length || files.length > MAX_FILES)
      throw new BadRequestException(
        `Subí entre 1 y ${MAX_FILES} archivos por operación (PDF, TXT, RTF, DOC, DOCX u ODT).`,
      );
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'PERSONAL',
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
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
          await this.ingestOne(
            null,
            user.id,
            file,
            folderId,
            undefined,
            folderUploadPolicy,
          ),
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
    return { destination: 'Mis documentos', access: 'Sólo vos', results };
  }

  uploadPersonalFolder(
    user: AuthenticatedUser,
    files: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }>,
    folderId?: string,
  ) {
    return this.uploadPersonal(user, files, folderId, true);
  }

  async searchPersonal(
    user: AuthenticatedUser,
    q: string,
    page = 1,
    pageSize = 20,
    folderId?: string | null,
  ): Promise<SearchResultPage | null> {
    if (!q?.trim()) throw new BadRequestException('Ingresá una búsqueda.');
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'PERSONAL',
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
      throw new NotFoundException('Carpeta no encontrada.');
    const result = await this.search.federatedSearch(q, 'AND', {
      visibility: 'ADMIN',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      sourceSystems: ['CORPUS'],
      page,
      pageSize,
      documentScope: {
        kind: 'PERSONAL',
        userId: user.id,
        ...(folderId !== undefined ? { folderId } : {}),
      },
    });
    if (!result?.results.length) return result;
    const associations = await this.prisma.workspaceDocument.findMany({
      where: {
        workspaceId: null,
        ownerUserId: user.id,
        documentId: { in: result.results.map((item) => item.sourceId) },
      },
      select: {
        documentId: true,
        folder: { select: { id: true, name: true } },
      },
    });
    const byId = new Map(
      associations.map((row) => [row.documentId, row.folder]),
    );
    return {
      ...result,
      results: result.results.map((row) => {
        const folder = byId.get(row.sourceId);
        return {
          ...row,
          metadata: {
            ...row.metadata,
            folderId: folder?.id ?? null,
            folderName: folder?.name ?? 'Mis documentos',
            visibilityLabel: 'Privado',
          },
        };
      }),
    };
  }

  personalMetadata(id: string, user: AuthenticatedUser, page?: number) {
    return this.documents.metadata(id, 'RESTRICTED', page, undefined, user.id);
  }

  personalMatches(id: string, user: AuthenticatedUser, q: string) {
    return this.documents.matches(id, 'RESTRICTED', q, undefined, user.id);
  }

  personalFile(id: string, user: AuthenticatedUser) {
    return this.documents.file(id, 'RESTRICTED', undefined, user.id);
  }

  async sharePersonalDocument(
    documentId: string,
    user: AuthenticatedUser,
    input: {
      workspaceId: string;
      folderId?: string | null;
      confirmAccessChange: boolean;
    },
  ) {
    if (input.confirmAccessChange !== true)
      throw new BadRequestException(
        'Al mover este documento, las personas autorizadas de la dependencia podrán verlo. Confirmá el cambio para continuar.',
      );
    const membership = await this.requireMembership(input.workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const document = await this.prisma.workspaceDocument.findFirst({
      where: { documentId, workspaceId: null, ownerUserId: user.id },
      select: {
        id: true,
        folderId: true,
        document: {
          select: { sourceFiles: { select: { id: true }, take: 1 } },
        },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    if (document.document.sourceFiles.length)
      throw new ForbiddenException(
        'Un documento sincronizado de una carpeta de red no se puede cambiar a personal ni compartir desde acá.',
      );
    const targetFolderId = input.folderId || null;
    if (targetFolderId) {
      const readableIds = await readableFolderIds(this.prisma, {
        kind: 'WORKSPACE',
        workspaceId: input.workspaceId,
        userId: user.id,
      });
      if (!readableIds.includes(targetFolderId))
        throw new NotFoundException('Carpeta no encontrada.');
      if (
        (await this.effectiveFolderScope(targetFolderId)) ===
        WorkspaceVisibilityScope.PERSONAL
      )
        throw new BadRequestException(
          'El destino personal pertenece a otra persona.',
        );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceDocument.update({
        where: { id: document.id },
        data: {
          workspaceId: input.workspaceId,
          ownerUserId: null,
          folderId: targetFolderId,
        },
      });
      await tx.accionLog.create({
        data: {
          usuarioId: user.id,
          entidad: 'WorkspaceDocument',
          entidadId: null,
          accion: 'VISIBILITY_CHANGED',
          descripcion:
            'Documento personal compartido explícitamente con una dependencia.',
          datosAntes: { scope: 'PERSONAL' },
          datosDespues: {
            scope: targetFolderId ? 'FOLDER_SCOPE' : 'DEPENDENCY_SHARED',
            workspaceId: input.workspaceId,
            folderId: targetFolderId,
          },
        },
      });
    });
    return {
      documentId,
      visibility: targetFolderId
        ? await this.effectiveFolderScope(targetFolderId)
        : WorkspaceVisibilityScope.DEPENDENCY_SHARED,
    };
  }

  async makeDocumentPersonal(
    workspaceId: string,
    documentId: string,
    user: AuthenticatedUser,
    input: { folderId?: string | null; confirmAccessChange: boolean },
  ) {
    if (input.confirmAccessChange !== true)
      throw new BadRequestException(
        'Después de moverlo, sólo vos podrás verlo. Confirmá el cambio para continuar.',
      );
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [
      WorkspaceRole.ADMIN,
      WorkspaceRole.EDITOR,
    ]);
    const link = await this.prisma.workspaceDocument.findFirst({
      where: { workspaceId, documentId, ownerUserId: null },
      select: {
        id: true,
        uploadedById: true,
        document: {
          select: { sourceFiles: { select: { id: true }, take: 1 } },
        },
      },
    });
    if (!link) throw new NotFoundException('Documento no encontrado.');
    if (link.document.sourceFiles.length)
      throw new ForbiddenException(
        'Los documentos sincronizados de una carpeta de red permanecen compartidos con la dependencia.',
      );
    if (
      membership.role !== WorkspaceRole.ADMIN &&
      link.uploadedById !== user.id
    )
      throw new ForbiddenException(
        'Sólo quien cargó el documento o una persona responsable puede hacerlo personal.',
      );
    const folderId = input.folderId || null;
    if (
      folderId &&
      !(
        await readableFolderIds(this.prisma, {
          kind: 'PERSONAL',
          userId: user.id,
        })
      ).includes(folderId)
    )
      throw new NotFoundException('Carpeta no encontrada.');
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceDocument.update({
        where: { id: link.id },
        data: { workspaceId: null, ownerUserId: user.id, folderId },
      });
      await tx.accionLog.create({
        data: {
          usuarioId: user.id,
          entidad: 'WorkspaceDocument',
          entidadId: null,
          accion: 'VISIBILITY_CHANGED',
          descripcion: 'Documento de la dependencia pasó a ser personal.',
          datosAntes: { scope: 'DEPENDENCY_SHARED', workspaceId },
          datosDespues: { scope: 'PERSONAL', ownerUserId: user.id, folderId },
        },
      });
    });
    return { documentId, visibility: WorkspaceVisibilityScope.PERSONAL };
  }

  documentsInWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    folderId?: string | null,
  ): Promise<WorkspaceDocumentListItem[]>;
  documentsInWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    folderId: string | null | undefined,
    page: number | undefined,
    pageSize: number | undefined,
    filters?: { type?: string; dateFrom?: string; dateTo?: string },
  ): Promise<WorkspaceDocumentListItem[] | WorkspaceDocumentListPage>;
  async documentsInWorkspace(
    workspaceId: string,
    user: AuthenticatedUser,
    folderId?: string | null,
    page?: number,
    pageSize?: number,
    filters?: { type?: string; dateFrom?: string; dateTo?: string },
  ): Promise<WorkspaceDocumentListItem[] | WorkspaceDocumentListPage> {
    const membership = await this.requireMembership(workspaceId, user);
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
      throw new NotFoundException('Carpeta no encontrada.');
    const dateRange = validateSearchDateRange(
      filters?.dateFrom,
      filters?.dateTo,
    );
    const types = validateCorpusTypes(filters?.type);
    const where = {
      workspaceId,
      ownerUserId: null,
      ...(dateRange.dateFrom || dateRange.dateTo
        ? {
            createdAt: {
              ...(dateRange.dateFrom
                ? { gte: new Date(`${dateRange.dateFrom}T00:00:00.000Z`) }
                : {}),
              ...(dateRange.dateTo
                ? { lte: new Date(`${dateRange.dateTo}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {}),
      ...(types
        ? {
            document: {
              files: {
                some: { mimeType: { in: mimeTypesForCorpusTypes(types) } },
              },
            },
          }
        : {}),
      ...(folderId !== undefined
        ? { folderId }
        : { OR: [{ folderId: null }, { folderId: { in: readableIds } }] }),
    };
    const paginated = page !== undefined || pageSize !== undefined;
    const normalizedPage = paginated ? Math.max(1, page ?? 1) : 1;
    const normalizedPageSize = paginated
      ? Math.min(100, Math.max(1, pageSize ?? 20))
      : 100;
    const [links, total] = await Promise.all([
      this.prisma.workspaceDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: normalizedPageSize,
        ...(paginated
          ? { skip: (normalizedPage - 1) * normalizedPageSize }
          : {}),
        include: {
          uploadedBy: { select: { nombre: true, apellido: true } },
          document: {
            select: {
              id: true,
              title: true,
              status: true,
              documentType: true,
              createdAt: true,
              sourceFiles: { take: 1, select: { id: true } },
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
                select: {
                  status: true,
                  pages: { select: { pageNumber: true } },
                },
              },
            },
          },
          folder: { select: { id: true, name: true, visibilityScope: true } },
        },
      }),
      paginated
        ? this.prisma.workspaceDocument.count({ where })
        : Promise.resolve(0),
    ]);
    const results = await Promise.all(
      links.map(async ({ document, folder, ...link }) => ({
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
          sourceFiles: undefined,
        },
        canMakePersonal:
          document.sourceFiles.length === 0 &&
          (membership.role === WorkspaceRole.ADMIN ||
            link.uploadedById === user.id),
        folder: folder
          ? {
              id: folder.id,
              name: folder.name,
              visibilityLabel: workspaceVisibilityLabel(
                await this.effectiveFolderScope(folder.id),
              ),
            }
          : null,
        visibilityLabel: folder
          ? workspaceVisibilityLabel(await this.effectiveFolderScope(folder.id))
          : 'Compartido',
      })),
    );
    return paginated
      ? {
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total,
          results,
        }
      : results;
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
        `Subí entre 1 y ${MAX_FILES} archivos por operación (PDF, TXT, RTF, DOC, DOCX u ODT).`,
      );
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
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
    | (SearchResultPage & {
        documentCoverage: WorkspaceDocumentSearchCoverage;
      })
    | null
  > {
    await this.requireMembership(workspaceId, user);
    if (!q?.trim()) throw new BadRequestException('Ingresá una búsqueda.');
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
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
        userId: user.id,
        ...(folderId !== undefined ? { folderId } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(normalizedSourceFolder
          ? { sourceFolder: normalizedSourceFolder }
          : {}),
      },
    });
    if (!result) return null;
    const documentCoverage = await this.workspaceDocumentSearchCoverage(
      workspaceId,
      readableIds,
    );
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
      documentCoverage,
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

  private async workspaceDocumentSearchCoverage(
    workspaceId: string,
    readableIds: string[],
  ): Promise<WorkspaceDocumentSearchCoverage> {
    const folderScope = readableIds.length
      ? Prisma.sql`(workspaceDocument."folderId" IS NULL OR workspaceDocument."folderId" IN (${Prisma.join(readableIds)}))`
      : Prisma.sql`workspaceDocument."folderId" IS NULL`;
    const groups = await this.prisma.$queryRaw<
      Array<{ status: string; count: bigint }>
    >(Prisma.sql`
      SELECT document."status" AS "status",
             count(DISTINCT document."id")::bigint AS "count"
        FROM "WorkspaceDocument" workspaceDocument
        JOIN "CorpusDocument" document
          ON document."id" = workspaceDocument."documentId"
       WHERE workspaceDocument."workspaceId" = ${workspaceId}
         AND workspaceDocument."ownerUserId" IS NULL
         AND ${folderScope}
         AND (
           document."documentScope" = 'PRIVATE_WORKSPACE'
           OR (
             document."documentScope" = 'GENERAL'
             AND document."visibility" IN ('PUBLIC', 'INTERNAL')
             AND EXISTS (
               SELECT 1
                 FROM "CorpusDocumentLink" sentenceLink
                 JOIN "Sentencia" sentence
                   ON sentence."id" = CASE
                     WHEN sentenceLink."targetId" ~ '^[0-9]+$'
                       THEN sentenceLink."targetId"::integer
                     ELSE NULL
                   END
                WHERE sentenceLink."documentId" = document."id"
                  AND sentenceLink."targetDomain" = 'JURISPRUDENCIA'
                  AND sentenceLink."targetType" = 'SENTENCIA'
                  AND sentenceLink."relationship" = 'ASSOCIATED_WITH'
                  AND sentence.activo = TRUE
                  AND sentence.publicado = TRUE
                  AND sentence."estadoCarga" = 'PUBLICADA'
             )
           )
         )
       GROUP BY document."status"
    `);
    const countFor = (statuses: string[]) =>
      groups
        .filter((group) => statuses.includes(group.status))
        .reduce((sum, group) => sum + Number(group.count), 0);
    const textAvailableDocuments = countFor(['INDEXED']);
    const ocrRequiredDocuments = countFor(['OCR_REQUIRED']);
    const total = groups.reduce((sum, group) => sum + Number(group.count), 0);
    return {
      textAvailableDocuments,
      ocrRequiredDocuments,
      otherUnavailableDocuments:
        total - textAvailableDocuments - ocrRequiredDocuments,
    };
  }

  async searchSources(workspaceId: string, user: AuthenticatedUser) {
    await this.requireMembership(workspaceId, user);
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
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
          ownerUserId: null,
          OR: [
            { folderId: null },
            {
              folderId: {
                in: readableIds,
              },
            },
          ],
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
    const readableIds = await readableFolderIds(this.prisma, {
      kind: 'WORKSPACE',
      workspaceId,
      userId: user.id,
    });
    if (folderId && !readableIds.includes(folderId))
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
    const escapedTerm = term.replace(/[\\%_]/gu, (value) => `\\${value}`);
    const namePattern = `%${escapedTerm}%`;
    const predicates: Prisma.Sql[] = [
      Prisma.sql`workspaceDocument."workspaceId" = ${workspaceId}`,
      Prisma.sql`workspaceDocument."ownerUserId" IS NULL`,
      readableIds.length
        ? Prisma.sql`(workspaceDocument."folderId" IS NULL OR workspaceDocument."folderId" IN (${Prisma.join(readableIds)}))`
        : Prisma.sql`workspaceDocument."folderId" IS NULL`,
      Prisma.sql`(
        document."documentScope" = 'PRIVATE_WORKSPACE'
        OR (
          document."documentScope" = 'GENERAL'
          AND document."visibility" IN ('PUBLIC', 'INTERNAL')
          AND EXISTS (
            SELECT 1
              FROM "CorpusDocumentLink" sentenceLink
              JOIN "Sentencia" sentence
                ON sentence."id" = CASE
                  WHEN sentenceLink."targetId" ~ '^[0-9]+$'
                    THEN sentenceLink."targetId"::integer
                  ELSE NULL
                END
             WHERE sentenceLink."documentId" = document."id"
               AND sentenceLink."targetDomain" = 'JURISPRUDENCIA'
               AND sentenceLink."targetType" = 'SENTENCIA'
               AND sentenceLink."relationship" = 'ASSOCIATED_WITH'
               AND sentence.activo = TRUE
               AND sentence.publicado = TRUE
               AND sentence."estadoCarga" = 'PUBLICADA'
          )
        )
      )`,
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
    const namePredicate = Prisma.sql`(document."title" ILIKE ${namePattern} ESCAPE E'\\\\' OR latestFile."originalFilename" ILIKE ${namePattern} ESCAPE E'\\\\')`;
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
    const postgresFrom = Prisma.sql`${from} AND ${namePredicate}`;
    const [countRows, links] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT count(*)::bigint AS "total" ${postgresFrom}`,
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
          matchedTitle: boolean;
          matchedFilename: boolean;
        }>
      >(Prisma.sql`
        SELECT workspaceDocument."documentId" AS "documentId",
               document."title" AS "title",
               document."status" AS "status",
               latestFile."originalFilename" AS "filename",
               latestFile."mimeType" AS "mimeType",
               workspaceDocument."createdAt" AS "uploadedAt",
               folder."id" AS "folderId",
               folder."name" AS "folderName",
               COALESCE(document."title" ILIKE ${namePattern} ESCAPE E'\\\\', false) AS "matchedTitle",
               COALESCE(latestFile."originalFilename" ILIKE ${namePattern} ESCAPE E'\\\\', false) AS "matchedFilename"
          ${postgresFrom}
         ORDER BY workspaceDocument."createdAt" DESC, workspaceDocument."documentId" ASC
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
        matchedIn: [
          ...(link.matchedFilename ? ['FILENAME'] : []),
          ...(link.matchedTitle ? ['TITLE'] : []),
        ],
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
    return this.documents.metadata(
      id,
      'RESTRICTED',
      page,
      workspaceId,
      user.id,
    );
  }
  async matches(
    workspaceId: string,
    id: string,
    user: AuthenticatedUser,
    q: string,
  ) {
    await this.requireMembership(workspaceId, user);
    return this.documents.matches(id, 'RESTRICTED', q, workspaceId, user.id);
  }
  async file(workspaceId: string, id: string, user: AuthenticatedUser) {
    await this.requireMembership(workspaceId, user);
    return this.documents.file(id, 'RESTRICTED', workspaceId, user.id);
  }

  async manageMember(
    workspaceId: string,
    user: AuthenticatedUser,
    input: { userId: number; role: WorkspaceRole; active?: boolean },
  ) {
    await this.requireWorkspaceManagementAdmin(workspaceId, user);
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
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId, userId: input.userId } },
        create: {
          workspaceId,
          userId: input.userId,
          role: input.role,
          active: input.active ?? true,
        },
        update: { role: input.role, active: input.active ?? true },
      });
      if (updated.active === false)
        await tx.workspaceFolderGrant.deleteMany({
          where: { membershipId: updated.id },
        });
      return updated;
    });
    await this.audit(user.id, workspaceId, 'MEMBER_UPSERT', {
      memberUserId: input.userId,
      role: result.role,
      active: result.active,
    });
    return { userId: result.userId, role: result.role, active: result.active };
  }

  private async ingestOne(
    workspaceId: string | null,
    userId: number,
    file: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
    folderId?: string,
    replaceDocumentId?: string,
    personalFolderUpload = false,
  ) {
    const name = path
      .basename(file.originalname)
      .replace(/[\r\n]/gu, '_')
      .slice(0, 255);
    if (file.buffer.byteLength > MAX_FILE_BYTES || file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('El archivo supera el límite de 20 MiB.');
    }
    let extraction: ExtractionResult;
    try {
      extraction = await extractor.extract(name, file.mimetype, file.buffer);
    } catch (error) {
      if (error instanceof InvalidPdfError)
        throw new BadRequestException('PDF inválido: ' + name);
      if (error instanceof DocumentExtractionError) {
        if (error.code === 'MACRO_DOCUMENT')
          throw new BadRequestException(
            'Los documentos con macros no están admitidos.',
          );
        if (error.code === 'LEGACY_DOC_UNSUPPORTED')
          throw new BadRequestException(
            'DOC legacy no está disponible en esta instalación.',
          );
        throw new BadRequestException(
          'El archivo no es válido o su formato no está admitido.',
        );
      }
      throw error;
    }
    if (personalFolderUpload) {
      const issue = personalFolderUploadIssue({
        filename: name,
        submittedMimeType: file.mimetype,
        detectedFormat: extraction.formatDetected,
      });
      if (issue) throw new BadRequestException(issue);
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
        ...(workspaceId
          ? { workspaceId, ownerUserId: null }
          : { workspaceId: null, ownerUserId: userId }),
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
    const metadataOriginal = {
      source: replaceDocumentId ? 'workspace-source' : 'workspace-upload',
      extractionProvenance: extractionProvenance(extraction),
    } as Prisma.InputJsonObject;
    const document = await this.prisma.$transaction(async (tx) => {
      const documentData = {
        documentType: 'PRIVATE_DOCUMENT',
        title: name.replace(/\.(?:pdf|txt|rtf|docx?|odt)$/iu, ''),
        jurisdiction: 'CIVIL',
        visibility: 'RESTRICTED',
        documentScope: 'PRIVATE_WORKSPACE' as const,
        status:
          extraction.status === 'OCR_REQUIRED'
            ? ('OCR_REQUIRED' as const)
            : ('INDEXED' as const),
        searchText: extraction.text,
      } satisfies Prisma.CorpusDocumentUncheckedCreateInput;
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
              mimeType: extraction.mimeDetected,
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
          ...(extraction.provenance
            ? {
                provenance: extraction.provenance as Prisma.InputJsonValue,
              }
            : {}),
          pages: {
            create: extraction.pages.map((page) => ({
              ...page,
              textKind: 'NATIVE',
              processingStatus:
                extraction.formatDetected === 'PDF' &&
                extraction.ocrRequiredPages.includes(page.pageNumber)
                  ? 'OCR_REQUIRED'
                  : 'TEXT_NATIVE',
            })),
          },
        },
      });
      if (replaceDocumentId) {
        await tx.corpusOcrJob.updateMany({
          where: {
            documentId: doc.id,
            fileId: { not: storedFile.id },
            status: 'PENDING',
          },
          data: {
            status: 'CANCELLED',
            completedAt: new Date(),
            errorCode: 'SOURCE_REPLACED',
            errorDetail: 'A newer source version replaced this pending job.',
          },
        });
      }
      const ocrPages =
        extraction.formatDetected === 'PDF' ? extraction.ocrRequiredPages : [];
      const job = ocrPages.length
        ? await enqueueLocalOcrJob(tx, this.ocrProcessor, {
            documentId: doc.id,
            fileId: storedFile.id,
            fileSha256: stored.sha256,
            pageNumbers: ocrPages,
          })
        : null;
      const finalStatus =
        extraction.status === 'OCR_REQUIRED'
          ? job
            ? 'OCR_PROCESSING'
            : 'OCR_REQUIRED'
          : 'INDEXED';
      await tx.corpusDocument.update({
        where: { id: doc.id },
        data: { latestExtractionId: extracted.id, status: finalStatus },
      });
      const idempotencyKey = replaceDocumentId
        ? `workspace-source:${workspaceId}:${doc.id}:${stored.sha256}`
        : workspaceId
          ? `workspace:${workspaceId}:${folderId ?? 'ROOT'}:${stored.sha256}`
          : `personal:${userId}:${folderId ?? 'ROOT'}:${stored.sha256}`;
      await tx.corpusIngestionRecord.upsert({
        where: { idempotencyKey },
        update: {
          sourceSystemId: source.id,
          documentId: doc.id,
          fileId: storedFile.id,
          status: finalStatus,
          checksum: stored.sha256,
          idempotencyKey,
          originalFilename: name,
          metadataOriginal: {
            ...metadataOriginal,
          },
        },
        create: {
          sourceSystemId: source.id,
          documentId: doc.id,
          fileId: storedFile.id,
          status: finalStatus,
          checksum: stored.sha256,
          idempotencyKey,
          originalFilename: name,
          metadataOriginal: {
            ...metadataOriginal,
          },
        },
      });
      if (!replaceDocumentId)
        await tx.workspaceDocument.create({
          data: {
            workspaceId,
            ownerUserId: workspaceId ? null : userId,
            documentId: doc.id,
            folderId: folderId ?? null,
            uploadedById: userId,
          },
        });
      await tx.accionLog.create({
        data: {
          usuarioId: userId,
          entidad: 'WorkspaceDocument',
          accion: replaceDocumentId
            ? 'SOURCE_REPROCESS'
            : workspaceId
              ? 'UPLOAD'
              : 'PERSONAL_UPLOAD',
          descripcion: replaceDocumentId
            ? 'Versión de fuente documental actualizada.'
            : workspaceId
              ? 'Documento incorporado al espacio de la dependencia.'
              : 'Documento personal incorporado.',
          datosDespues: {
            workspaceId,
            documentId: doc.id,
            sha256: stored.sha256,
            bytes: stored.sizeBytes,
            status: finalStatus,
          },
        },
      });
      return {
        id: doc.id,
        status: finalStatus,
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
  private async requireWorkspaceManagementAdmin(
    workspaceId: string,
    user: AuthenticatedUser,
  ) {
    if (user.rol.nombre === 'ADMIN') {
      const workspace = await this.prisma.documentWorkspace.findFirst({
        where: { id: workspaceId, active: true },
        select: { id: true },
      });
      if (!workspace) throw new NotFoundException('Espacio no encontrado.');
      return { role: WorkspaceRole.ADMIN };
    }
    const membership = await this.requireMembership(workspaceId, user);
    this.requireRole(membership.role, [WorkspaceRole.ADMIN]);
    return membership;
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

function validateDeletionReason(reason: string) {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  if (normalized.length < 5 || normalized.length > 500)
    throw new BadRequestException(
      'Indicá un motivo de eliminación de entre 5 y 500 caracteres.',
    );
  return normalized;
}

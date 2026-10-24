import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  DocumentSourceStatus,
  SourceFileStatus,
  SourceScanRunStatus,
  WorkspaceRole,
} from '../generated/prisma/client';
import type { SourceScanRun } from '../generated/prisma/client';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceDocumentService } from './workspace-document.service';
import {
  DocumentSourceScanner,
  type ScanPathIssue,
  type SourceFileSnapshot,
} from './document-source-scanner';

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.txt',
  '.rtf',
  '.doc',
  '.docx',
  '.odt',
]);

type SourceFileRow = {
  id: string;
  relativePath: string;
  normalizedPath: string;
  fileName: string;
  extension: string;
  sizeBytes: bigint;
  modifiedAt: Date;
  sha256: string | null;
  documentId: string | null;
  status: SourceFileStatus;
};

type RunCounters = {
  filesSeen: number;
  indexedCount: number;
  newCount: number;
  modifiedCount: number;
  unchangedCount: number;
  metadataOnlyCount: number;
  renamedCount: number;
  missingCount: number;
  unsupportedCount: number;
  errorCount: number;
  bytesSeen: bigint;
  hashCount: number;
  hashMs: number;
  enumerationMs: number;
  metadataComparisonMs: number;
  processingMs: number;
};

type PendingIngest = {
  snapshot: SourceFileSnapshot;
  sha256: string;
  change: 'NEW' | 'MODIFIED';
  prior?: SourceFileRow;
};

@Injectable()
export class DocumentSourceService implements OnModuleInit {
  private readonly startingSources = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly scanner: DocumentSourceScanner,
  ) {}

  async onModuleInit() {
    const stale = await this.prisma.sourceScanRun.findMany({
      where: {
        status: {
          in: [SourceScanRunStatus.QUEUED, SourceScanRunStatus.RUNNING],
        },
      },
      select: { id: true, sourceId: true },
    });
    if (!stale.length) return;
    const completedAt = new Date();
    await this.prisma.sourceScanRun.updateMany({
      where: { id: { in: stale.map((run) => run.id) } },
      data: {
        status: SourceScanRunStatus.FAILED,
        activeLockSourceId: null,
        completedAt,
        scanComplete: false,
        errorMessage: 'El backend se reinició durante el escaneo.',
      },
    });
    await this.prisma.documentSource.updateMany({
      where: { id: { in: stale.map((run) => run.sourceId) } },
      data: {
        status: DocumentSourceStatus.ERROR,
        lastError: 'El escaneo anterior fue interrumpido.',
      },
    });
  }

  async testAccess(
    workspaceId: string,
    user: AuthenticatedUser,
    rawPath: string,
  ) {
    await this.requireWorkspaceAdmin(workspaceId, user.id);
    let root: string;
    try {
      root = this.scanner.validateNetworkPath(rawPath);
    } catch {
      throw new BadRequestException('La ruta debe ser una carpeta UNC válida.');
    }
    try {
      const connected = await this.scanner.testAccess(root);
      return { status: connected ? 'CONNECTED' : 'NOT_FOUND' };
    } catch (error) {
      return { status: accessStatus(error) };
    }
  }

  async list(workspaceId: string, user: AuthenticatedUser) {
    await this.requireWorkspaceAdmin(workspaceId, user.id);
    const sources = await this.prisma.documentSource.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        _count: { select: { files: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return sources.map(({ runs, _count, ...source }) => ({
      ...source,
      lastRun: runs[0] ? presentRun(runs[0]) : null,
      fileCount: _count.files,
    }));
  }

  async create(
    workspaceId: string,
    user: AuthenticatedUser,
    input: { name?: string; path?: string },
  ) {
    await this.requireWorkspaceAdmin(workspaceId, user.id);
    const name = (input.name ?? '').trim();
    if (!name || name.length > 120)
      throw new BadRequestException('Nombre de fuente inválido.');
    let root: string;
    try {
      root = this.scanner.validateNetworkPath(input.path ?? '');
    } catch {
      throw new BadRequestException('La ruta debe ser una carpeta UNC válida.');
    }
    const source = await this.prisma.documentSource.create({
      data: {
        workspaceId,
        name,
        path: root,
        type: 'NETWORK_FOLDER',
        createdById: user.id,
      },
    });
    await this.audit(user.id, workspaceId, 'SOURCE_CREATE', {
      sourceId: source.id,
      name,
    });
    return source;
  }

  async get(workspaceId: string, sourceId: string, user: AuthenticatedUser) {
    await this.getAuthorizedSource(workspaceId, sourceId, user.id);
    const source = await this.prisma.documentSource.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        _count: { select: { files: true } },
        runs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const { runs, _count, ...details } = source;
    return {
      ...details,
      fileCount: _count.files,
      lastRun: runs[0] ? presentRun(runs[0]) : null,
    };
  }

  async update(
    workspaceId: string,
    sourceId: string,
    user: AuthenticatedUser,
    input: { name?: string; path?: string; enabled?: boolean },
  ) {
    await this.getAuthorizedSource(workspaceId, sourceId, user.id);
    const data: {
      name?: string;
      path?: string;
      enabled?: boolean;
      status?: DocumentSourceStatus;
      lastError?: string | null;
    } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 120)
        throw new BadRequestException('Nombre de fuente inválido.');
      data.name = name;
    }
    if (input.path !== undefined) {
      try {
        data.path = this.scanner.validateNetworkPath(input.path);
      } catch {
        throw new BadRequestException(
          'La ruta debe ser una carpeta UNC válida.',
        );
      }
      data.status = DocumentSourceStatus.UNKNOWN;
      data.lastError = null;
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean')
        throw new BadRequestException('Estado de fuente inválido.');
      data.enabled = input.enabled;
    }
    if (!Object.keys(data).length)
      throw new BadRequestException('No hay cambios para guardar.');
    const updated = await this.prisma.documentSource.update({
      where: { id: sourceId },
      data,
    });
    await this.audit(
      user.id,
      workspaceId,
      input.enabled === undefined
        ? 'SOURCE_UPDATE'
        : input.enabled
          ? 'SOURCE_ENABLE'
          : 'SOURCE_DISABLE',
      {
        sourceId,
        name: updated.name,
        enabled: updated.enabled,
      },
    );
    return updated;
  }

  async files(
    workspaceId: string,
    sourceId: string,
    user: AuthenticatedUser,
    page = 1,
  ) {
    await this.getAuthorizedSource(workspaceId, sourceId, user.id);
    const pageSize = 100;
    const rows = await this.prisma.sourceFile.findMany({
      where: { sourceId },
      orderBy: [{ normalizedPath: 'asc' }],
      skip: (Math.max(1, page) - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        relativePath: true,
        fileName: true,
        extension: true,
        sizeBytes: true,
        modifiedAt: true,
        status: true,
        documentId: true,
        lastSeenAt: true,
        lastProcessedAt: true,
        lastError: true,
      },
    });
    return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
  }

  async runs(workspaceId: string, sourceId: string, user: AuthenticatedUser) {
    await this.getAuthorizedSource(workspaceId, sourceId, user.id);
    const rows = await this.prisma.sourceScanRun.findMany({
      where: { sourceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(presentRun);
  }

  async scan(workspaceId: string, sourceId: string, user: AuthenticatedUser) {
    const lockKey = `${workspaceId}:${sourceId}`;
    if (this.startingSources.has(lockKey))
      throw new ConflictException(
        'Ya hay un escaneo solicitado para esta fuente.',
      );
    this.startingSources.add(lockKey);
    try {
      const source = await this.getAuthorizedSource(
        workspaceId,
        sourceId,
        user.id,
      );
      if (!source.enabled)
        throw new BadRequestException('La fuente está pausada.');
      const active = await this.prisma.sourceScanRun.findFirst({
        where: {
          sourceId,
          status: {
            in: [SourceScanRunStatus.QUEUED, SourceScanRunStatus.RUNNING],
          },
        },
        select: { id: true },
      });
      if (active)
        throw new ConflictException(
          'Ya hay un escaneo activo para esta fuente.',
        );
      let run: SourceScanRun;
      try {
        run = await this.prisma.sourceScanRun.create({
          data: { sourceId, activeLockSourceId: sourceId },
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        )
          throw new ConflictException(
            'Ya hay un escaneo activo para esta fuente.',
          );
        throw error;
      }
      await this.prisma.documentSource.update({
        where: { id: sourceId },
        data: { lastScanStartedAt: run.createdAt },
      });
      setImmediate(
        () => void this.executeScan(run.id, sourceId, workspaceId, user.id),
      );
      void this.audit(user.id, workspaceId, 'SOURCE_SCAN_REQUEST', {
        sourceId,
        runId: run.id,
      }).catch(() => undefined);
      return presentRun(run);
    } finally {
      this.startingSources.delete(lockKey);
    }
  }

  async executeScan(
    runId: string,
    sourceId: string,
    workspaceId: string,
    requestedById: number,
  ) {
    const started = Date.now();
    const counters: RunCounters = {
      filesSeen: 0,
      indexedCount: 0,
      newCount: 0,
      modifiedCount: 0,
      unchangedCount: 0,
      metadataOnlyCount: 0,
      renamedCount: 0,
      missingCount: 0,
      unsupportedCount: 0,
      errorCount: 0,
      bytesSeen: 0n,
      hashCount: 0,
      hashMs: 0,
      enumerationMs: 0,
      metadataComparisonMs: 0,
      processingMs: 0,
    };
    let scanComplete = true;
    let fatalMessage: string | null = null;
    const issues: ScanPathIssue[] = [];
    const snapshots: SourceFileSnapshot[] = [];
    const seenPaths = new Set<string>();
    const hashed: PendingIngest[] = [];
    const unchangedIds: string[] = [];
    try {
      const source = await this.prisma.documentSource.findUnique({
        where: { id: sourceId },
        select: {
          workspaceId: true,
          path: true,
          enabled: true,
          createdById: true,
        },
      });
      if (!source || source.workspaceId !== workspaceId || !source.enabled)
        throw new Error('SOURCE_UNAVAILABLE');
      const root = this.scanner.validateNetworkPath(source.path);
      await this.prisma.sourceScanRun.update({
        where: { id: runId },
        data: { status: SourceScanRunStatus.RUNNING, startedAt: new Date() },
      });
      await this.prisma.documentSource.update({
        where: { id: sourceId },
        data: { status: DocumentSourceStatus.UNKNOWN, lastError: null },
      });
      const existing = await this.prisma.sourceFile.findMany({
        where: { sourceId },
      });
      const byPath = new Map(
        existing.map((row) => [row.normalizedPath, row as SourceFileRow]),
      );

      const enumerationStarted = Date.now();
      try {
        for await (const snapshot of this.scanner.enumerate(root, (issue) => {
          issues.push(issue);
          scanComplete = false;
        })) {
          snapshots.push(snapshot);
          seenPaths.add(snapshot.normalizedPath);
          counters.filesSeen += 1;
          counters.bytesSeen += BigInt(snapshot.sizeBytes);
        }
      } catch (error) {
        scanComplete = false;
        fatalMessage = safeErrorMessage(error);
      }
      counters.enumerationMs = Date.now() - enumerationStarted;
      await this.prisma.sourceScanRun.update({
        where: { id: runId },
        data: {
          filesSeen: counters.filesSeen,
          bytesSeen: counters.bytesSeen,
          enumerationMs: counters.enumerationMs,
        },
      });

      const compareStarted = Date.now();
      for (const snapshot of snapshots) {
        const prior = byPath.get(snapshot.normalizedPath);
        if (!SUPPORTED_EXTENSIONS.has(snapshot.extension)) {
          counters.unsupportedCount += 1;
          await this.persistSnapshot(sourceId, snapshot, {
            status: SourceFileStatus.UNSUPPORTED,
            lastError: 'Formato no soportado en esta versión.',
          });
          continue;
        }
        const metadataMatches = Boolean(
          prior &&
          Number(prior.sizeBytes) === snapshot.sizeBytes &&
          prior.modifiedAt.getTime() === snapshot.modifiedAt.getTime() &&
          prior.status !== SourceFileStatus.ERROR &&
          prior.status !== SourceFileStatus.PROCESSING &&
          prior.status !== SourceFileStatus.MISSING,
        );
        if (metadataMatches) {
          counters.unchangedCount += 1;
          if (prior) unchangedIds.push(prior.id);
          continue;
        }
        const hashStarted = Date.now();
        let sha256: string;
        try {
          sha256 = await this.scanner.hash(snapshot, root);
        } catch (error) {
          counters.hashMs += Date.now() - hashStarted;
          counters.hashCount += 1;
          counters.errorCount += 1;
          await this.persistSnapshot(sourceId, snapshot, {
            status: SourceFileStatus.ERROR,
            lastError: safeErrorMessage(error),
          });
          continue;
        }
        counters.hashMs += Date.now() - hashStarted;
        counters.hashCount += 1;
        if (prior?.sha256 === sha256 && prior.documentId) {
          counters.unchangedCount += 1;
          counters.metadataOnlyCount += 1;
          await this.persistSnapshot(sourceId, snapshot, {
            status: SourceFileStatus.UNCHANGED,
            sha256,
            documentId: prior.documentId,
            lastError: null,
          });
          continue;
        }
        hashed.push({
          snapshot,
          sha256,
          change: prior?.sha256 ? 'MODIFIED' : 'NEW',
          prior,
        });
      }
      counters.metadataComparisonMs = Date.now() - compareStarted;
      for (let offset = 0; offset < unchangedIds.length; offset += 1000) {
        await this.prisma.sourceFile.updateMany({
          where: { id: { in: unchangedIds.slice(offset, offset + 1000) } },
          data: {
            status: SourceFileStatus.UNCHANGED,
            lastSeenAt: new Date(),
            lastError: null,
          },
        });
      }
      await this.prisma.sourceScanRun.update({
        where: { id: runId },
        data: {
          filesSeen: counters.filesSeen,
          bytesSeen: counters.bytesSeen,
          hashCount: counters.hashCount,
          hashMs: counters.hashMs,
          enumerationMs: counters.enumerationMs,
          metadataComparisonMs: counters.metadataComparisonMs,
          unchangedCount: counters.unchangedCount,
          metadataOnlyCount: counters.metadataOnlyCount,
          unsupportedCount: counters.unsupportedCount,
          errorCount: counters.errorCount,
        },
      });

      const renameCandidates = detectUnambiguousRenames(
        hashed,
        existing,
        seenPaths,
      );
      const renamedIds = new Set<string>();
      for (const candidate of renameCandidates) {
        const { prior, pending } = candidate;
        await this.prisma.sourceFile.update({
          where: { id: prior.id },
          data: {
            relativePath: pending.snapshot.relativePath,
            normalizedPath: pending.snapshot.normalizedPath,
            fileName: pending.snapshot.fileName,
            extension: pending.snapshot.extension,
            sizeBytes: BigInt(pending.snapshot.sizeBytes),
            modifiedAt: pending.snapshot.modifiedAt,
            lastSeenAt: new Date(),
            status: SourceFileStatus.INDEXED,
            lastError: null,
          },
        });
        seenPaths.add(pending.snapshot.normalizedPath);
        renamedIds.add(prior.id);
        counters.renamedCount += 1;
      }
      const renamedNewPaths = new Set(
        renameCandidates.map(({ pending }) => pending.snapshot.normalizedPath),
      );

      const processingStarted = Date.now();
      for (const pending of hashed) {
        if (renamedNewPaths.has(pending.snapshot.normalizedPath)) continue;
        await this.persistSnapshot(sourceId, pending.snapshot, {
          status: SourceFileStatus.PROCESSING,
          lastError: null,
        });
        try {
          if (pending.snapshot.sizeBytes > MAX_SOURCE_FILE_BYTES)
            throw new Error('FILE_EXCEEDS_20MB');
          const beforeRead = await stat(pending.snapshot.absolutePath);
          const content = await readFile(pending.snapshot.absolutePath);
          const afterRead = await stat(pending.snapshot.absolutePath);
          if (
            beforeRead.size !== afterRead.size ||
            beforeRead.mtimeMs !== afterRead.mtimeMs ||
            content.byteLength !== pending.snapshot.sizeBytes ||
            createHash('sha256').update(content).digest('hex') !==
              pending.sha256
          )
            throw new Error('SOURCE_FILE_CHANGED_DURING_READ');
          const result = await this.workspaceDocuments.ingestFromSource(
            workspaceId,
            requestedById,
            {
              originalname: pending.snapshot.fileName,
              mimetype: 'application/octet-stream',
              buffer: content,
              size: content.byteLength,
            },
            pending.change === 'MODIFIED'
              ? (pending.prior?.documentId ?? undefined)
              : undefined,
          );
          await this.persistSnapshot(sourceId, pending.snapshot, {
            status: SourceFileStatus.INDEXED,
            sha256: pending.sha256,
            documentId: result.documentId,
            lastProcessedAt: new Date(),
            lastError: null,
          });
          if (pending.change === 'NEW') counters.newCount += 1;
          else counters.modifiedCount += 1;
        } catch (error) {
          counters.errorCount += 1;
          await this.persistSnapshot(sourceId, pending.snapshot, {
            status: SourceFileStatus.ERROR,
            lastError: safeErrorMessage(error),
          });
        }
      }
      counters.processingMs = Date.now() - processingStarted;

      if (scanComplete) {
        const reconciliationStarted = Date.now();
        for (const prior of existing as SourceFileRow[]) {
          if (
            seenPaths.has(prior.normalizedPath) ||
            renamedIds.has(prior.id) ||
            prior.status === SourceFileStatus.MISSING
          )
            continue;
          await this.prisma.sourceFile.update({
            where: { id: prior.id },
            data: { status: SourceFileStatus.MISSING, lastError: null },
          });
          counters.missingCount += 1;
        }
        counters.processingMs += Date.now() - reconciliationStarted;
      }

      counters.indexedCount = await this.prisma.sourceFile.count({
        where: {
          sourceId,
          status: {
            in: [SourceFileStatus.INDEXED, SourceFileStatus.UNCHANGED],
          },
        },
      });

      const completedAt = new Date();
      const status = scanComplete
        ? counters.errorCount > 0
          ? SourceScanRunStatus.PARTIAL
          : SourceScanRunStatus.COMPLETED
        : snapshots.length
          ? SourceScanRunStatus.PARTIAL
          : SourceScanRunStatus.FAILED;
      const message =
        fatalMessage ??
        (issues.length
          ? 'Se omitieron rutas de tipo enlace o fuera de la raíz.'
          : null);
      await this.prisma.sourceScanRun.update({
        where: { id: runId },
        data: {
          ...counters,
          status,
          activeLockSourceId: null,
          scanComplete,
          completedAt,
          totalDurationMs: Date.now() - started,
          errorMessage: message,
        },
      });
      await this.prisma.documentSource.update({
        where: { id: sourceId },
        data: {
          status: scanComplete
            ? DocumentSourceStatus.CONNECTED
            : accessStatusFromMessage(message),
          lastScanCompletedAt: completedAt,
          ...(scanComplete
            ? {
                lastSuccessfulScanAt: completedAt,
                lastError: counters.errorCount
                  ? 'El escaneo terminó con archivos que requieren revisión.'
                  : null,
              }
            : { lastError: message }),
        },
      });
      await this.prisma.accionLog
        .create({
          data: {
            usuarioId: requestedById,
            entidad: 'DocumentSource',
            accion: scanComplete
              ? 'SOURCE_SCAN_COMPLETED'
              : 'SOURCE_SCAN_FAILED',
            descripcion: scanComplete
              ? 'Escaneo de fuente documental completado.'
              : 'Escaneo de fuente documental incompleto.',
            datosDespues: {
              workspaceId,
              sourceId,
              runId,
              status,
              scanComplete,
              filesSeen: counters.filesSeen,
              errorCount: counters.errorCount,
            },
          },
        })
        .catch(() => undefined);
    } catch (error) {
      const completedAt = new Date();
      const message = safeErrorMessage(error);
      await this.prisma.sourceScanRun
        .update({
          where: { id: runId },
          data: {
            ...counters,
            status: SourceScanRunStatus.FAILED,
            activeLockSourceId: null,
            scanComplete: false,
            completedAt,
            totalDurationMs: Date.now() - started,
            errorMessage: message,
          },
        })
        .catch(() => undefined);
      await this.prisma.documentSource
        .update({
          where: { id: sourceId },
          data: {
            status: accessStatusFromMessage(message),
            lastScanCompletedAt: completedAt,
            lastError: message,
          },
        })
        .catch(() => undefined);
    }
  }

  private async persistSnapshot(
    sourceId: string,
    snapshot: SourceFileSnapshot,
    update: {
      status: SourceFileStatus;
      sha256?: string | null;
      documentId?: string | null;
      lastProcessedAt?: Date;
      lastError: string | null;
    },
  ) {
    const common = {
      relativePath: snapshot.relativePath,
      fileName: snapshot.fileName,
      extension: snapshot.extension,
      sizeBytes: BigInt(snapshot.sizeBytes),
      modifiedAt: snapshot.modifiedAt,
      lastSeenAt: new Date(),
      status: update.status,
      lastError: update.lastError,
      ...(update.sha256 !== undefined ? { sha256: update.sha256 } : {}),
      ...(update.documentId !== undefined
        ? { documentId: update.documentId }
        : {}),
      ...(update.lastProcessedAt !== undefined
        ? { lastProcessedAt: update.lastProcessedAt }
        : {}),
    };
    await this.prisma.sourceFile.upsert({
      where: {
        sourceId_normalizedPath: {
          sourceId,
          normalizedPath: snapshot.normalizedPath,
        },
      },
      create: { sourceId, normalizedPath: snapshot.normalizedPath, ...common },
      update: common,
    });
  }

  private async getAuthorizedSource(
    workspaceId: string,
    sourceId: string,
    userId: number,
  ) {
    await this.requireWorkspaceAdmin(workspaceId, userId);
    const source = await this.prisma.documentSource.findFirst({
      where: { id: sourceId, workspaceId },
    });
    if (!source) throw new NotFoundException('Fuente no encontrada.');
    return source;
  }

  private async requireWorkspaceAdmin(workspaceId: string, userId: number) {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        workspaceId,
        userId,
        active: true,
        role: WorkspaceRole.ADMIN,
        workspace: { active: true },
      },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Espacio no encontrado.');
  }

  private audit(
    userId: number,
    workspaceId: string,
    action: string,
    details: Record<string, string | boolean>,
  ) {
    return this.prisma.accionLog.create({
      data: {
        usuarioId: userId,
        entidad: 'DocumentSource',
        accion: action,
        descripcion: 'Administración de fuente documental privada.',
        datosDespues: { workspaceId, ...details },
      },
    });
  }
}

function detectUnambiguousRenames(
  pending: PendingIngest[],
  existing: SourceFileRow[],
  seenPaths: Set<string>,
) {
  const newBySha = new Map<string, PendingIngest[]>();
  for (const item of pending) {
    if (item.change !== 'NEW') continue;
    const group = newBySha.get(item.sha256) ?? [];
    group.push(item);
    newBySha.set(item.sha256, group);
  }
  const oldBySha = new Map<string, SourceFileRow[]>();
  for (const item of existing) {
    if (
      !item.sha256 ||
      !item.documentId ||
      seenPaths.has(item.normalizedPath) ||
      item.status === SourceFileStatus.MISSING
    )
      continue;
    const group = oldBySha.get(item.sha256) ?? [];
    group.push(item);
    oldBySha.set(item.sha256, group);
  }
  const matches: Array<{ prior: SourceFileRow; pending: PendingIngest }> = [];
  for (const [sha256, newGroup] of newBySha) {
    const oldGroup = oldBySha.get(sha256);
    if (newGroup.length === 1 && oldGroup?.length === 1)
      matches.push({ prior: oldGroup[0], pending: newGroup[0] });
  }
  return matches;
}

function accessStatus(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code === 'EACCES' || code === 'EPERM') return 'ACCESS_DENIED';
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'NOT_FOUND';
  if (
    [
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENETDOWN',
    ].includes(code)
  )
    return 'OFFLINE';
  return 'ERROR';
}

function accessStatusFromMessage(message: string | null) {
  if (message === 'ACCESS_DENIED') return DocumentSourceStatus.ACCESS_DENIED;
  if (message === 'NOT_FOUND' || message === 'OFFLINE')
    return DocumentSourceStatus.OFFLINE;
  return DocumentSourceStatus.ERROR;
}

function safeErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code) return accessStatus(error);
  const message = error instanceof Error ? error.message : '';
  if (message === 'FILE_EXCEEDS_20MB')
    return 'El archivo supera el límite de 20 MiB del pipeline actual.';
  if (message === 'SOURCE_FILE_CHANGED_DURING_READ')
    return 'El archivo cambió mientras se leía; se reintentará en el próximo escaneo.';
  if (
    message === 'SOURCE_FILE_UNSAFE' ||
    message === 'SOURCE_FILE_OUTSIDE_ROOT'
  )
    return 'Se omitió una ruta insegura o fuera de la raíz.';
  if (message.startsWith('PDF inválido:')) return 'PDF inválido.';
  return 'No se pudo procesar este archivo.';
}

function presentRun<T extends { bytesSeen: bigint }>(run: T) {
  return { ...run, bytesSeen: Number(run.bytesSeen) };
}

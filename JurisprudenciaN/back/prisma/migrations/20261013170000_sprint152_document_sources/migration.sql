CREATE TYPE "DocumentSourceType" AS ENUM ('MANUAL_UPLOAD', 'NETWORK_FOLDER', 'LOCAL_AGENT');
CREATE TYPE "DocumentSourceStatus" AS ENUM ('UNKNOWN', 'CONNECTED', 'OFFLINE', 'ACCESS_DENIED', 'ERROR');
CREATE TYPE "SourceFileStatus" AS ENUM ('DISCOVERED', 'UNCHANGED', 'NEW', 'MODIFIED', 'PROCESSING', 'INDEXED', 'MISSING', 'ERROR', 'UNSUPPORTED');
CREATE TYPE "SourceScanRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TABLE "DocumentSource" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "DocumentSourceType" NOT NULL DEFAULT 'NETWORK_FOLDER',
  "path" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" "DocumentSourceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "lastScanStartedAt" TIMESTAMP(3),
  "lastScanCompletedAt" TIMESTAMP(3),
  "lastSuccessfulScanAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentSource_workspaceId_enabled_idx" ON "DocumentSource"("workspaceId", "enabled");
CREATE INDEX "DocumentSource_workspaceId_createdAt_idx" ON "DocumentSource"("workspaceId", "createdAt");
ALTER TABLE "DocumentSource" ADD CONSTRAINT "DocumentSource_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentSource" ADD CONSTRAINT "DocumentSource_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SourceFile" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "normalizedPath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "modifiedAt" TIMESTAMP(3) NOT NULL,
  "sha256" TEXT,
  "documentId" TEXT,
  "status" "SourceFileStatus" NOT NULL DEFAULT 'DISCOVERED',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastProcessedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceFile_sourceId_normalizedPath_key" ON "SourceFile"("sourceId", "normalizedPath");
CREATE INDEX "SourceFile_sourceId_status_idx" ON "SourceFile"("sourceId", "status");
CREATE INDEX "SourceFile_sourceId_sha256_idx" ON "SourceFile"("sourceId", "sha256");
CREATE INDEX "SourceFile_documentId_idx" ON "SourceFile"("documentId");
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DocumentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceFile" ADD CONSTRAINT "SourceFile_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SourceScanRun" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "activeLockSourceId" TEXT,
  "status" "SourceScanRunStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "scanComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  "filesSeen" INTEGER NOT NULL DEFAULT 0,
  "indexedCount" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "modifiedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "metadataOnlyCount" INTEGER NOT NULL DEFAULT 0,
  "renamedCount" INTEGER NOT NULL DEFAULT 0,
  "missingCount" INTEGER NOT NULL DEFAULT 0,
  "unsupportedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "bytesSeen" BIGINT NOT NULL DEFAULT 0,
  "hashCount" INTEGER NOT NULL DEFAULT 0,
  "hashMs" INTEGER NOT NULL DEFAULT 0,
  "enumerationMs" INTEGER NOT NULL DEFAULT 0,
  "metadataComparisonMs" INTEGER NOT NULL DEFAULT 0,
  "processingMs" INTEGER NOT NULL DEFAULT 0,
  "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceScanRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceScanRun_activeLockSourceId_key" ON "SourceScanRun"("activeLockSourceId");
CREATE INDEX "SourceScanRun_sourceId_startedAt_idx" ON "SourceScanRun"("sourceId", "startedAt" DESC);
ALTER TABLE "SourceScanRun" ADD CONSTRAINT "SourceScanRun_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DocumentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

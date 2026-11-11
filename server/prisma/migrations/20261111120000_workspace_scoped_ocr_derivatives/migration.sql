CREATE TABLE "WorkspaceOcrJob" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL DEFAULT 'default',
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "latestExtractionId" TEXT NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "processorVersion" TEXT NOT NULL,
    "languages" TEXT NOT NULL,
    "dpi" INTEGER NOT NULL,
    "pageNumbers" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "timeoutMs" INTEGER NOT NULL DEFAULT 90000,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceOcrJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceOcrPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceOcrPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceOcrJob_workspaceId_fileId_fingerprint_key"
    ON "WorkspaceOcrJob"("workspaceId", "fileId", "fingerprint");
CREATE INDEX "WorkspaceOcrJob_queueName_status_createdAt_idx"
    ON "WorkspaceOcrJob"("queueName", "status", "createdAt");
CREATE INDEX "WorkspaceOcrJob_workspaceId_documentId_status_createdAt_idx"
    ON "WorkspaceOcrJob"("workspaceId", "documentId", "status", "createdAt");
CREATE INDEX "WorkspaceOcrJob_fileId_fileSha256_idx"
    ON "WorkspaceOcrJob"("fileId", "fileSha256");
CREATE UNIQUE INDEX "WorkspaceOcrPage_workspaceId_documentId_fileId_extractionId_pageNumber_key"
    ON "WorkspaceOcrPage"("workspaceId", "documentId", "fileId", "extractionId", "pageNumber");
CREATE INDEX "WorkspaceOcrPage_workspaceId_documentId_fileId_extractionId_idx"
    ON "WorkspaceOcrPage"("workspaceId", "documentId", "fileId", "extractionId");
CREATE INDEX "WorkspaceOcrPage_jobId_idx" ON "WorkspaceOcrPage"("jobId");

ALTER TABLE "WorkspaceOcrJob" ADD CONSTRAINT "WorkspaceOcrJob_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrJob" ADD CONSTRAINT "WorkspaceOcrJob_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrJob" ADD CONSTRAINT "WorkspaceOcrJob_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrJob" ADD CONSTRAINT "WorkspaceOcrJob_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceOcrPage" ADD CONSTRAINT "WorkspaceOcrPage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "DocumentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrPage" ADD CONSTRAINT "WorkspaceOcrPage_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrPage" ADD CONSTRAINT "WorkspaceOcrPage_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceOcrPage" ADD CONSTRAINT "WorkspaceOcrPage_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "WorkspaceOcrJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

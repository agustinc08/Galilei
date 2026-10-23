ALTER TABLE "CorpusDocument"
  ADD COLUMN "editorialStatus" TEXT NOT NULL DEFAULT 'NO_REVIEWED',
  ADD COLUMN "anonymizationStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED';

CREATE TABLE "CorpusDocumentRepositoryRoot" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "rootType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "readOnly" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "excludedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusDocumentRepositoryRoot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorpusDocumentRepositoryRoot_relativePath_key" ON "CorpusDocumentRepositoryRoot"("relativePath");
CREATE INDEX "CorpusDocumentRepositoryRoot_active_rootType_idx" ON "CorpusDocumentRepositoryRoot"("active", "rootType");

CREATE TABLE "CorpusDocumentLocation" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "rootId" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "modifiedAt" TIMESTAMP(3),
  "sourceMissing" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusDocumentLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentLocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorpusDocumentLocation_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "CorpusDocumentRepositoryRoot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentLocation_rootId_relativePath_key" ON "CorpusDocumentLocation"("rootId", "relativePath");
CREATE INDEX "CorpusDocumentLocation_documentId_sha256_idx" ON "CorpusDocumentLocation"("documentId", "sha256");
CREATE INDEX "CorpusDocumentLocation_sha256_idx" ON "CorpusDocumentLocation"("sha256");
CREATE INDEX "CorpusDocumentLocation_sourceMissing_idx" ON "CorpusDocumentLocation"("sourceMissing");

CREATE TABLE "CorpusImportRun" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "sourceCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "roots" JSONB NOT NULL,
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "physicalFiles" INTEGER NOT NULL DEFAULT 0,
  "uniqueHashes" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "newDocuments" INTEGER NOT NULL DEFAULT 0,
  "reusedDocuments" INTEGER NOT NULL DEFAULT 0,
  "linked" INTEGER NOT NULL DEFAULT 0,
  "suggested" INTEGER NOT NULL DEFAULT 0,
  "unresolved" INTEGER NOT NULL DEFAULT 0,
  "extracted" INTEGER NOT NULL DEFAULT 0,
  "pages" INTEGER NOT NULL DEFAULT 0,
  "characters" BIGINT NOT NULL DEFAULT 0,
  "ocrRequired" INTEGER NOT NULL DEFAULT 0,
  "invalidPdf" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "bytesProcessed" BIGINT NOT NULL DEFAULT 0,
  "filesPerMinute" DOUBLE PRECISION,
  "mbPerMinute" DOUBLE PRECISION,
  "extractP50Ms" DOUBLE PRECISION,
  "extractP95Ms" DOUBLE PRECISION,
  "errorSummary" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusImportRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CorpusImportRun_scanId_status_idx" ON "CorpusImportRun"("scanId", "status");
CREATE INDEX "CorpusImportRun_startedAt_idx" ON "CorpusImportRun"("startedAt");

CREATE TABLE "CorpusImportRunItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "documentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "extractionStatus" TEXT,
  "associationConfidence" TEXT,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "pages" INTEGER NOT NULL DEFAULT 0,
  "characters" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "errorStage" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusImportRunItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusImportRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CorpusImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorpusImportRunItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusImportRunItem_runId_itemKey_key" ON "CorpusImportRunItem"("runId", "itemKey");
CREATE INDEX "CorpusImportRunItem_status_updatedAt_idx" ON "CorpusImportRunItem"("status", "updatedAt");
CREATE INDEX "CorpusImportRunItem_documentId_idx" ON "CorpusImportRunItem"("documentId");

CREATE TABLE "CorpusDocumentAssociation" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "targetDomain" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL DEFAULT '',
  "confidence" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL DEFAULT 'REVIEW_PENDING',
  "origin" TEXT NOT NULL DEFAULT 'LEGACY',
  "evidence" JSONB,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusDocumentAssociation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentAssociation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentAssociation_documentId_targetDomain_targetType_targetId_key" ON "CorpusDocumentAssociation"("documentId", "targetDomain", "targetType", "targetId");
CREATE INDEX "CorpusDocumentAssociation_targetDomain_confidence_reviewStatus_idx" ON "CorpusDocumentAssociation"("targetDomain", "confidence", "reviewStatus");
CREATE INDEX "CorpusDocumentAssociation_documentId_reviewStatus_idx" ON "CorpusDocumentAssociation"("documentId", "reviewStatus");

CREATE TABLE "CorpusDocumentClassification" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "reviewStatus" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "evidence" JSONB,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusDocumentClassification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentClassification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentClassification_documentId_category_value_origin_key" ON "CorpusDocumentClassification"("documentId", "category", "value", "origin");
CREATE INDEX "CorpusDocumentClassification_category_value_reviewStatus_idx" ON "CorpusDocumentClassification"("category", "value", "reviewStatus");
CREATE INDEX "CorpusDocumentClassification_documentId_reviewStatus_idx" ON "CorpusDocumentClassification"("documentId", "reviewStatus");
CREATE INDEX "CorpusDocumentClassification_origin_confidence_idx" ON "CorpusDocumentClassification"("origin", "confidence");

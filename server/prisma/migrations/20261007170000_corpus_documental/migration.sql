CREATE TABLE "CorpusSourceSystem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sourceType" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "baseUrl" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusSourceSystem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorpusSourceSystem_code_key" ON "CorpusSourceSystem"("code");

CREATE TABLE "CorpusDocument" (
  "id" TEXT NOT NULL,
  "documentType" TEXT NOT NULL DEFAULT 'DOCUMENT',
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "jurisdiction" TEXT NOT NULL DEFAULT 'CIVIL',
  "court" TEXT,
  "chamber" TEXT,
  "instance" TEXT,
  "caseNumber" TEXT,
  "docket" TEXT,
  "decisionDate" TIMESTAMP(3),
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "metadata" JSONB,
  "metadataOriginal" JSONB,
  "searchText" TEXT NOT NULL DEFAULT '',
  "latestExtractionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CorpusDocument_visibility_status_idx" ON "CorpusDocument"("visibility", "status");
CREATE INDEX "CorpusDocument_decisionDate_idx" ON "CorpusDocument"("decisionDate");
CREATE INDEX "CorpusDocument_documentType_jurisdiction_idx" ON "CorpusDocument"("documentType", "jurisdiction");
CREATE INDEX "CorpusDocument_caseNumber_idx" ON "CorpusDocument"("caseNumber");
CREATE INDEX "CorpusDocument_court_idx" ON "CorpusDocument"("court");

CREATE TABLE "CorpusDocumentFile" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL_DEV',
  "storageKey" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "pageCount" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusDocumentFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentFile_documentId_sha256_key" ON "CorpusDocumentFile"("documentId", "sha256");
CREATE INDEX "CorpusDocumentFile_sha256_idx" ON "CorpusDocumentFile"("sha256");
CREATE INDEX "CorpusDocumentFile_documentId_version_idx" ON "CorpusDocumentFile"("documentId", "version");

CREATE TABLE "CorpusIngestionRecord" (
  "id" TEXT NOT NULL,
  "sourceSystemId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "fileId" TEXT,
  "externalId" TEXT,
  "externalUrl" TEXT,
  "sourceReference" TEXT,
  "obtainedAt" TIMESTAMP(3),
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
  "checksum" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "sourcePath" TEXT,
  "metadataOriginal" JSONB,
  "errorStage" TEXT,
  "errorMessage" TEXT,
  "errorAt" TIMESTAMP(3),
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorpusIngestionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusIngestionRecord_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "CorpusSourceSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorpusIngestionRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorpusIngestionRecord_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusIngestionRecord_idempotencyKey_key" ON "CorpusIngestionRecord"("idempotencyKey");
CREATE INDEX "CorpusIngestionRecord_sourceSystemId_externalId_idx" ON "CorpusIngestionRecord"("sourceSystemId", "externalId");
CREATE INDEX "CorpusIngestionRecord_documentId_ingestedAt_idx" ON "CorpusIngestionRecord"("documentId", "ingestedAt");
CREATE INDEX "CorpusIngestionRecord_status_ingestedAt_idx" ON "CorpusIngestionRecord"("status", "ingestedAt");
CREATE INDEX "CorpusIngestionRecord_checksum_idx" ON "CorpusIngestionRecord"("checksum");

CREATE TABLE "CorpusExtraction" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "extractor" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "error" TEXT,
  "errorStage" TEXT,
  "errorAt" TIMESTAMP(3),
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusExtraction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorpusExtraction_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CorpusExtraction_documentId_extractedAt_idx" ON "CorpusExtraction"("documentId", "extractedAt");
CREATE INDEX "CorpusExtraction_fileId_extractor_extractorVersion_idx" ON "CorpusExtraction"("fileId", "extractor", "extractorVersion");
CREATE INDEX "CorpusExtraction_status_extractedAt_idx" ON "CorpusExtraction"("status", "extractedAt");

CREATE TABLE "CorpusDocumentPage" (
  "id" TEXT NOT NULL,
  "extractionId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  CONSTRAINT "CorpusDocumentPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentPage_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "CorpusExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentPage_extractionId_pageNumber_key" ON "CorpusDocumentPage"("extractionId", "pageNumber");
CREATE INDEX "CorpusDocumentPage_pageNumber_idx" ON "CorpusDocumentPage"("pageNumber");

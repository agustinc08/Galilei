ALTER TABLE "CorpusExtraction"
  ADD COLUMN "provenance" JSONB;

ALTER TABLE "CorpusDocumentPage"
  ADD COLUMN "textKind" TEXT NOT NULL DEFAULT 'NATIVE',
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'TEXT_NATIVE',
  ADD COLUMN "ocrConfidence" DOUBLE PRECISION;

CREATE TABLE "CorpusOcrJob" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "fileSha256" TEXT NOT NULL,
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
  CONSTRAINT "CorpusOcrJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusOcrJob_attempts_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" BETWEEN 1 AND 2),
  CONSTRAINT "CorpusOcrJob_dpi_check" CHECK ("dpi" BETWEEN 100 AND 600),
  CONSTRAINT "CorpusOcrJob_timeout_check" CHECK ("timeoutMs" BETWEEN 1000 AND 3600000)
);

CREATE UNIQUE INDEX "CorpusOcrJob_fileId_fingerprint_key"
  ON "CorpusOcrJob"("fileId", "fingerprint");
CREATE INDEX "CorpusOcrJob_status_createdAt_idx"
  ON "CorpusOcrJob"("status", "createdAt");
CREATE INDEX "CorpusOcrJob_documentId_createdAt_idx"
  ON "CorpusOcrJob"("documentId", "createdAt");
CREATE INDEX "CorpusOcrJob_fileId_fileSha256_idx"
  ON "CorpusOcrJob"("fileId", "fileSha256");

ALTER TABLE "CorpusOcrJob"
  ADD CONSTRAINT "CorpusOcrJob_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusOcrJob"
  ADD CONSTRAINT "CorpusOcrJob_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstitutionalIngestion" (
    "id" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "duplicateDetected" BOOLEAN NOT NULL DEFAULT false,
    "extractionStatus" TEXT,
    "matchClassification" TEXT,
    "candidateIds" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "documentId" TEXT,
    "fileId" TEXT,
    "corpusIngestionId" TEXT,
    "linkedSentenciaId" INTEGER,
    "confirmedMetadata" JSONB,
    "failureCode" TEXT,
    "failureMessageSafe" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionalIngestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionalIngestionEvent" (
    "id" TEXT NOT NULL,
    "ingestionId" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "safeOutcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionalIngestionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstitutionalIngestion_idempotencyKey_key"
ON "InstitutionalIngestion"("idempotencyKey");
CREATE INDEX "InstitutionalIngestion_status_createdAt_id_idx"
ON "InstitutionalIngestion"("status", "createdAt", "id");
CREATE INDEX "InstitutionalIngestion_createdById_status_createdAt_idx"
ON "InstitutionalIngestion"("createdById", "status", "createdAt");
CREATE INDEX "InstitutionalIngestion_sha256_idx"
ON "InstitutionalIngestion"("sha256");
CREATE INDEX "InstitutionalIngestion_linkedSentenciaId_idx"
ON "InstitutionalIngestion"("linkedSentenciaId");
CREATE INDEX "InstitutionalIngestionEvent_ingestionId_createdAt_id_idx"
ON "InstitutionalIngestionEvent"("ingestionId", "createdAt", "id");
CREATE INDEX "InstitutionalIngestionEvent_actorId_createdAt_idx"
ON "InstitutionalIngestionEvent"("actorId", "createdAt");

ALTER TABLE "InstitutionalIngestion"
ADD CONSTRAINT "InstitutionalIngestion_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstitutionalIngestion"
ADD CONSTRAINT "InstitutionalIngestion_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstitutionalIngestion"
ADD CONSTRAINT "InstitutionalIngestion_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstitutionalIngestion"
ADD CONSTRAINT "InstitutionalIngestion_linkedSentenciaId_fkey"
FOREIGN KEY ("linkedSentenciaId") REFERENCES "Sentencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InstitutionalIngestionEvent"
ADD CONSTRAINT "InstitutionalIngestionEvent_ingestionId_fkey"
FOREIGN KEY ("ingestionId") REFERENCES "InstitutionalIngestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstitutionalIngestionEvent"
ADD CONSTRAINT "InstitutionalIngestionEvent_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

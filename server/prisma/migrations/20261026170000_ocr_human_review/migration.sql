CREATE TABLE "OcrHumanReview" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "assignedToId" INTEGER,
    "activeRunId" TEXT,
    "activeApprovalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OcrHumanReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OcrHumanReviewRun" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceFileSha256" TEXT NOT NULL,
    "processorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "pageCount" INTEGER NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OcrHumanReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OcrHumanReviewPage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "ocrText" TEXT NOT NULL DEFAULT '',
    "correctedText" TEXT,
    "ocrChecksum" TEXT NOT NULL,
    "renderedImageSha256" TEXT,
    "confidence" DOUBLE PRECISION,
    "processingError" TEXT,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "approvedChecksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OcrHumanReviewPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OcrHumanReviewRevision" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "pageId" TEXT,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "previousChecksum" TEXT,
    "newChecksum" TEXT,
    "textSnapshot" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OcrHumanReviewRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OcrHumanReviewApproval" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "approvedById" INTEGER NOT NULL,
    "sourceFileSha256" TEXT NOT NULL,
    "documentChecksum" TEXT NOT NULL,
    "searchTextChecksum" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OcrHumanReviewApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OcrHumanReview_documentId_fileId_key" ON "OcrHumanReview"("documentId", "fileId");
CREATE INDEX "OcrHumanReview_status_updatedAt_id_idx" ON "OcrHumanReview"("status", "updatedAt", "id");
CREATE INDEX "OcrHumanReview_assignedToId_status_updatedAt_idx" ON "OcrHumanReview"("assignedToId", "status", "updatedAt");
CREATE INDEX "OcrHumanReview_fileId_idx" ON "OcrHumanReview"("fileId");

CREATE UNIQUE INDEX "OcrHumanReviewRun_reviewId_runNumber_key" ON "OcrHumanReviewRun"("reviewId", "runNumber");
CREATE INDEX "OcrHumanReviewRun_reviewId_fingerprint_idx" ON "OcrHumanReviewRun"("reviewId", "fingerprint");
CREATE INDEX "OcrHumanReviewRun_reviewId_createdAt_idx" ON "OcrHumanReviewRun"("reviewId", "createdAt");
CREATE INDEX "OcrHumanReviewRun_sourceFileSha256_fingerprint_idx" ON "OcrHumanReviewRun"("sourceFileSha256", "fingerprint");

CREATE UNIQUE INDEX "OcrHumanReviewPage_runId_pageNumber_key" ON "OcrHumanReviewPage"("runId", "pageNumber");
CREATE INDEX "OcrHumanReviewPage_runId_status_pageNumber_idx" ON "OcrHumanReviewPage"("runId", "status", "pageNumber");
CREATE INDEX "OcrHumanReviewPage_approvedById_approvedAt_idx" ON "OcrHumanReviewPage"("approvedById", "approvedAt");

CREATE INDEX "OcrHumanReviewRevision_reviewId_createdAt_id_idx" ON "OcrHumanReviewRevision"("reviewId", "createdAt", "id");
CREATE INDEX "OcrHumanReviewRevision_pageId_createdAt_id_idx" ON "OcrHumanReviewRevision"("pageId", "createdAt", "id");
CREATE INDEX "OcrHumanReviewRevision_actorId_createdAt_idx" ON "OcrHumanReviewRevision"("actorId", "createdAt");

CREATE UNIQUE INDEX "OcrHumanReviewApproval_extractionId_key" ON "OcrHumanReviewApproval"("extractionId");
CREATE UNIQUE INDEX "OcrHumanReviewApproval_reviewId_sequence_key" ON "OcrHumanReviewApproval"("reviewId", "sequence");
CREATE INDEX "OcrHumanReviewApproval_reviewId_approvedAt_idx" ON "OcrHumanReviewApproval"("reviewId", "approvedAt");

ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "CorpusDocumentFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OcrHumanReviewRun"
    ADD CONSTRAINT "OcrHumanReviewRun_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "OcrHumanReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewRun"
    ADD CONSTRAINT "OcrHumanReviewRun_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OcrHumanReviewPage"
    ADD CONSTRAINT "OcrHumanReviewPage_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "OcrHumanReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OcrHumanReviewRevision"
    ADD CONSTRAINT "OcrHumanReviewRevision_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "OcrHumanReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewRevision"
    ADD CONSTRAINT "OcrHumanReviewRevision_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "OcrHumanReviewPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewRevision"
    ADD CONSTRAINT "OcrHumanReviewRevision_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OcrHumanReviewApproval"
    ADD CONSTRAINT "OcrHumanReviewApproval_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "OcrHumanReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewApproval"
    ADD CONSTRAINT "OcrHumanReviewApproval_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "OcrHumanReviewRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewApproval"
    ADD CONSTRAINT "OcrHumanReviewApproval_extractionId_fkey"
    FOREIGN KEY ("extractionId") REFERENCES "CorpusExtraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReviewApproval"
    ADD CONSTRAINT "OcrHumanReviewApproval_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_activeRunId_fkey"
    FOREIGN KEY ("activeRunId") REFERENCES "OcrHumanReviewRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OcrHumanReview"
    ADD CONSTRAINT "OcrHumanReview_activeApprovalId_fkey"
    FOREIGN KEY ("activeApprovalId") REFERENCES "OcrHumanReviewApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

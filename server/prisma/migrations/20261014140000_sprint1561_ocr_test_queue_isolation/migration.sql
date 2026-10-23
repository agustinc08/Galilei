ALTER TABLE "CorpusOcrJob"
  ADD COLUMN "queueName" TEXT NOT NULL DEFAULT 'default';

CREATE INDEX "CorpusOcrJob_queueName_status_createdAt_idx"
  ON "CorpusOcrJob"("queueName", "status", "createdAt");

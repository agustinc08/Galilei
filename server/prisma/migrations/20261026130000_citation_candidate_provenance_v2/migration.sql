ALTER TABLE "SentenciaRelationshipCandidate"
  ADD COLUMN "sourceExtractionId" TEXT,
  ADD COLUMN "sourceChecksum" TEXT,
  ADD COLUMN "parserVersion" TEXT,
  ADD COLUMN "citationFamily" TEXT,
  ADD COLUMN "parsedFields" JSONB,
  ADD COLUMN "sourcePage" INTEGER,
  ADD COLUMN "sourceStartOffset" INTEGER,
  ADD COLUMN "sourceEndOffset" INTEGER,
  ADD COLUMN "sourceTextKind" TEXT,
  ADD COLUMN "sourceContext" TEXT,
  ADD COLUMN "resolutionOutcome" TEXT,
  ADD COLUMN "resolutionReason" TEXT,
  ADD COLUMN "occurrenceKey" TEXT;

DROP INDEX "SentenciaRelationshipCandidate_sourceSentenceId_rawCitation_extractionMethod_key";

CREATE UNIQUE INDEX "SentenciaRelationshipCandidate_sourceSentenceId_occurrenceKey_key"
  ON "SentenciaRelationshipCandidate"("sourceSentenceId", "occurrenceKey");

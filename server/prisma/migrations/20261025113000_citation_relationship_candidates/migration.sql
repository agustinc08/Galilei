CREATE TYPE "RelationshipCandidateStatus" AS ENUM (
    'DETECTED_CANDIDATE',
    'VERIFIED',
    'REJECTED',
    'UNRESOLVED'
);

CREATE TABLE "SentenciaRelationshipCandidate" (
    "id" SERIAL NOT NULL,
    "sourceSentenceId" INTEGER NOT NULL,
    "targetSentenceId" INTEGER,
    "rawCitation" TEXT NOT NULL,
    "normalizedIdentifier" TEXT,
    "identifierType" TEXT,
    "relationshipType" TEXT NOT NULL DEFAULT 'CITES',
    "status" "RelationshipCandidateStatus" NOT NULL DEFAULT 'DETECTED_CANDIDATE',
    "extractionMethod" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "page" INTEGER,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SentenciaRelationshipCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SentenciaRelationshipCandidate_sourceSentenceId_rawCitation_extractionMethod_key"
    ON "SentenciaRelationshipCandidate"("sourceSentenceId", "rawCitation", "extractionMethod");
CREATE INDEX "SentenciaRelationshipCandidate_status_createdAt_idx"
    ON "SentenciaRelationshipCandidate"("status", "createdAt");
CREATE INDEX "SentenciaRelationshipCandidate_targetSentenceId_status_idx"
    ON "SentenciaRelationshipCandidate"("targetSentenceId", "status");
CREATE INDEX "SentenciaRelationshipCandidate_sourceSentenceId_status_idx"
    ON "SentenciaRelationshipCandidate"("sourceSentenceId", "status");

ALTER TABLE "SentenciaRelationshipCandidate"
    ADD CONSTRAINT "SentenciaRelationshipCandidate_sourceSentenceId_fkey"
    FOREIGN KEY ("sourceSentenceId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SentenciaRelationshipCandidate"
    ADD CONSTRAINT "SentenciaRelationshipCandidate_targetSentenceId_fkey"
    FOREIGN KEY ("targetSentenceId") REFERENCES "Sentencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SentenciaRelationshipCandidate"
    ADD CONSTRAINT "SentenciaRelationshipCandidate_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

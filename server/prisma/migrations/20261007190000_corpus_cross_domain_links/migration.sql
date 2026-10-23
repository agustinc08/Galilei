CREATE TABLE "CorpusDocumentLink" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "targetDomain" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusDocumentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CorpusDocumentLink_documentId_targetDomain_targetType_targetId_relationship_key"
  ON "CorpusDocumentLink"("documentId", "targetDomain", "targetType", "targetId", "relationship");
CREATE INDEX "CorpusDocumentLink_targetDomain_targetType_targetId_idx"
  ON "CorpusDocumentLink"("targetDomain", "targetType", "targetId");
CREATE INDEX "CorpusDocumentLink_documentId_relationship_idx"
  ON "CorpusDocumentLink"("documentId", "relationship");

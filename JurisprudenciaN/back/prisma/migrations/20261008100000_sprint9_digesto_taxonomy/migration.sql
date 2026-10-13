CREATE TABLE "DigestoCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigestoCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigestoCollectionMembership" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DigestoCollectionMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigestoTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigestoTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusDocumentTopic" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorpusDocumentTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigestoTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigestoTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpusDocumentTag" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorpusDocumentTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DigestoCollection_normalized_key" ON "DigestoCollection"("normalized");
CREATE INDEX "DigestoCollection_status_name_idx" ON "DigestoCollection"("status", "name");
CREATE UNIQUE INDEX "DigestoCollectionMembership_collectionId_documentId_key" ON "DigestoCollectionMembership"("collectionId", "documentId");
CREATE INDEX "DigestoCollectionMembership_documentId_idx" ON "DigestoCollectionMembership"("documentId");
CREATE UNIQUE INDEX "DigestoTopic_normalized_key" ON "DigestoTopic"("normalized");
CREATE INDEX "DigestoTopic_active_name_idx" ON "DigestoTopic"("active", "name");
CREATE UNIQUE INDEX "CorpusDocumentTopic_documentId_topicId_key" ON "CorpusDocumentTopic"("documentId", "topicId");
CREATE INDEX "CorpusDocumentTopic_topicId_idx" ON "CorpusDocumentTopic"("topicId");
CREATE UNIQUE INDEX "DigestoTag_normalized_key" ON "DigestoTag"("normalized");
CREATE UNIQUE INDEX "CorpusDocumentTag_documentId_tagId_key" ON "CorpusDocumentTag"("documentId", "tagId");
CREATE INDEX "CorpusDocumentTag_tagId_idx" ON "CorpusDocumentTag"("tagId");

ALTER TABLE "DigestoCollectionMembership" ADD CONSTRAINT "DigestoCollectionMembership_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DigestoCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DigestoCollectionMembership" ADD CONSTRAINT "DigestoCollectionMembership_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusDocumentTopic" ADD CONSTRAINT "CorpusDocumentTopic_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusDocumentTopic" ADD CONSTRAINT "CorpusDocumentTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "DigestoTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusDocumentTag" ADD CONSTRAINT "CorpusDocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CorpusDocumentTag" ADD CONSTRAINT "CorpusDocumentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DigestoTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

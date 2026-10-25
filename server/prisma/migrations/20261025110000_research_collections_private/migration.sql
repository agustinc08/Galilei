CREATE TABLE "ResearchCollection" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "nombreNormalizado" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchCollectionItem" (
    "id" SERIAL NOT NULL,
    "collectionId" INTEGER NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchCollectionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchCollection_usuarioId_nombreNormalizado_key"
    ON "ResearchCollection"("usuarioId", "nombreNormalizado");
CREATE INDEX "ResearchCollection_usuarioId_updatedAt_idx"
    ON "ResearchCollection"("usuarioId", "updatedAt");
CREATE UNIQUE INDEX "ResearchCollectionItem_collectionId_sentenciaId_key"
    ON "ResearchCollectionItem"("collectionId", "sentenciaId");
CREATE INDEX "ResearchCollectionItem_sentenciaId_idx"
    ON "ResearchCollectionItem"("sentenciaId");
CREATE INDEX "ResearchCollectionItem_collectionId_updatedAt_idx"
    ON "ResearchCollectionItem"("collectionId", "updatedAt");

ALTER TABLE "ResearchCollection"
    ADD CONSTRAINT "ResearchCollection_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchCollectionItem"
    ADD CONSTRAINT "ResearchCollectionItem_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "ResearchCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchCollectionItem"
    ADD CONSTRAINT "ResearchCollectionItem_sentenciaId_fkey"
    FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

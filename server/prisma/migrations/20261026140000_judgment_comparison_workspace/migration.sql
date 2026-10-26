CREATE TABLE "ResearchComparison" (
  "id" SERIAL NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchComparison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchComparisonItem" (
  "id" SERIAL NOT NULL,
  "comparisonId" INTEGER NOT NULL,
  "sentenciaId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchComparisonItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResearchComparison_ownerId_updatedAt_idx"
  ON "ResearchComparison"("ownerId", "updatedAt");

CREATE UNIQUE INDEX "ResearchComparisonItem_comparisonId_sentenciaId_key"
  ON "ResearchComparisonItem"("comparisonId", "sentenciaId");

CREATE UNIQUE INDEX "ResearchComparisonItem_comparisonId_position_key"
  ON "ResearchComparisonItem"("comparisonId", "position");

CREATE INDEX "ResearchComparisonItem_sentenciaId_idx"
  ON "ResearchComparisonItem"("sentenciaId");

ALTER TABLE "ResearchComparison"
  ADD CONSTRAINT "ResearchComparison_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchComparisonItem"
  ADD CONSTRAINT "ResearchComparisonItem_comparisonId_fkey"
  FOREIGN KEY ("comparisonId") REFERENCES "ResearchComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchComparisonItem"
  ADD CONSTRAINT "ResearchComparisonItem_sentenciaId_fkey"
  FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmbeddingDocumento" (
    "id" SERIAL NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "fuente" TEXT NOT NULL,
    "fuenteId" INTEGER,
    "embedding" JSONB NOT NULL,
    "textoResumen" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbeddingDocumento_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Sentencia" ADD COLUMN "resenaAi" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingDocumento_sentenciaId_fuente_fuenteId_key" ON "EmbeddingDocumento"("sentenciaId", "fuente", "fuenteId");

-- CreateIndex
CREATE INDEX "EmbeddingDocumento_sentenciaId_idx" ON "EmbeddingDocumento"("sentenciaId");

-- CreateIndex
CREATE INDEX "EmbeddingDocumento_fuente_idx" ON "EmbeddingDocumento"("fuente");

-- CreateIndex
CREATE INDEX "EmbeddingDocumento_createdAt_idx" ON "EmbeddingDocumento"("createdAt");

-- AddForeignKey
ALTER TABLE "EmbeddingDocumento" ADD CONSTRAINT "EmbeddingDocumento_sentenciaId_fkey" FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

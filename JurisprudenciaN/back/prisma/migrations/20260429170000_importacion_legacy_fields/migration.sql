ALTER TABLE "Sentencia"
ADD COLUMN "legacyLink" TEXT;

ALTER TABLE "ArchivoPdf"
ADD COLUMN "legacyId" TEXT;

CREATE INDEX "Sentencia_legacyLink_idx" ON "Sentencia"("legacyLink");
CREATE INDEX "ArchivoPdf_legacyId_idx" ON "ArchivoPdf"("legacyId");

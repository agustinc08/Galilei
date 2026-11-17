CREATE TYPE "EstadoValidacionVocabulario" AS ENUM (
    'PENDIENTE_REVISION',
    'APROBADO',
    'RECHAZADO'
);

ALTER TABLE "InstitutoJuridico"
    ADD COLUMN "materia" TEXT,
    ADD COLUMN "fuente" TEXT,
    ADD COLUMN "identificadorFuente" TEXT,
    ADD COLUMN "estadoValidacion" "EstadoValidacionVocabulario" NOT NULL DEFAULT 'PENDIENTE_REVISION',
    ADD COLUMN "creadoPorId" INTEGER,
    ADD COLUMN "revisadoPorId" INTEGER,
    ADD COLUMN "revisadoAt" TIMESTAMP(3),
    ADD COLUMN "observacionRevision" TEXT;

ALTER TABLE "SinonimoJuridico"
    ADD COLUMN "fuente" TEXT,
    ADD COLUMN "identificadorFuente" TEXT,
    ADD COLUMN "estadoValidacion" "EstadoValidacionVocabulario" NOT NULL DEFAULT 'PENDIENTE_REVISION',
    ADD COLUMN "creadoPorId" INTEGER,
    ADD COLUMN "revisadoPorId" INTEGER,
    ADD COLUMN "revisadoAt" TIMESTAMP(3),
    ADD COLUMN "observacionRevision" TEXT;

ALTER TABLE "InstitutoJuridico"
    ADD CONSTRAINT "InstitutoJuridico_creadoPorId_fkey"
        FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "InstitutoJuridico_revisadoPorId_fkey"
        FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SinonimoJuridico"
    ADD CONSTRAINT "SinonimoJuridico_creadoPorId_fkey"
        FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "SinonimoJuridico_revisadoPorId_fkey"
        FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

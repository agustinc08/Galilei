ALTER TABLE "BusquedaGuardada"
ADD COLUMN "alertasActivas" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ReporteProblema" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "tipo" VARCHAR(32) NOT NULL,
    "descripcion" VARCHAR(4000) NOT NULL,
    "ruta" VARCHAR(500) NOT NULL,
    "accion" VARCHAR(1000),
    "modulo" VARCHAR(120) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "errorId" VARCHAR(80),
    "estado" VARCHAR(32) NOT NULL DEFAULT 'NUEVO',
    "prioridad" VARCHAR(2) NOT NULL DEFAULT 'P3',
    "notasAdmin" VARCHAR(4000),
    "duplicadoDeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReporteProblema_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReporteProblema_estado_createdAt_idx"
ON "ReporteProblema"("estado", "createdAt");

CREATE INDEX "ReporteProblema_prioridad_createdAt_idx"
ON "ReporteProblema"("prioridad", "createdAt");

CREATE INDEX "ReporteProblema_usuarioId_createdAt_idx"
ON "ReporteProblema"("usuarioId", "createdAt");

CREATE INDEX "ReporteProblema_duplicadoDeId_idx"
ON "ReporteProblema"("duplicadoDeId");

ALTER TABLE "ReporteProblema"
ADD CONSTRAINT "ReporteProblema_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReporteProblema"
ADD CONSTRAINT "ReporteProblema_duplicadoDeId_fkey"
FOREIGN KEY ("duplicadoDeId") REFERENCES "ReporteProblema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Sentencia" ADD COLUMN     "salaId" INTEGER,
ADD COLUMN     "tipoFalloId" INTEGER,
ADD COLUMN     "tribunalOrigenId" INTEGER;

-- CreateTable
CREATE TABLE "Sala" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoFallo" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoFallo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TribunalOrigen" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TribunalOrigen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sala_nombre_key" ON "Sala"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Sala_codigo_key" ON "Sala"("codigo");

-- CreateIndex
CREATE INDEX "Sala_activa_idx" ON "Sala"("activa");

-- CreateIndex
CREATE INDEX "Sala_orden_idx" ON "Sala"("orden");

-- CreateIndex
CREATE UNIQUE INDEX "TipoFallo_nombre_key" ON "TipoFallo"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "TipoFallo_codigo_key" ON "TipoFallo"("codigo");

-- CreateIndex
CREATE INDEX "TipoFallo_activo_idx" ON "TipoFallo"("activo");

-- CreateIndex
CREATE INDEX "TipoFallo_orden_idx" ON "TipoFallo"("orden");

-- CreateIndex
CREATE UNIQUE INDEX "TribunalOrigen_nombre_key" ON "TribunalOrigen"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "TribunalOrigen_codigo_key" ON "TribunalOrigen"("codigo");

-- CreateIndex
CREATE INDEX "TribunalOrigen_activo_idx" ON "TribunalOrigen"("activo");

-- CreateIndex
CREATE INDEX "TribunalOrigen_orden_idx" ON "TribunalOrigen"("orden");

-- CreateIndex
CREATE INDEX "Sentencia_salaId_idx" ON "Sentencia"("salaId");

-- CreateIndex
CREATE INDEX "Sentencia_tipoFalloId_idx" ON "Sentencia"("tipoFalloId");

-- CreateIndex
CREATE INDEX "Sentencia_tribunalOrigenId_idx" ON "Sentencia"("tribunalOrigenId");

-- AddForeignKey
ALTER TABLE "Sentencia" ADD CONSTRAINT "Sentencia_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentencia" ADD CONSTRAINT "Sentencia_tipoFalloId_fkey" FOREIGN KEY ("tipoFalloId") REFERENCES "TipoFallo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentencia" ADD CONSTRAINT "Sentencia_tribunalOrigenId_fkey" FOREIGN KEY ("tribunalOrigenId") REFERENCES "TribunalOrigen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "EquivalenciaNormativa_articuloOrigenId_articuloDestinoId_tipoRe" RENAME TO "EquivalenciaNormativa_articuloOrigenId_articuloDestinoId_ti_key";

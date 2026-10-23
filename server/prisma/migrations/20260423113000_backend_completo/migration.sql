-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Rol" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "rolId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sentencia" (
    "id" SERIAL NOT NULL,
    "legacyId" TEXT,
    "numeroSentencia" TEXT,
    "tipoFallo" TEXT,
    "sala" TEXT,
    "fecha" TIMESTAMP(3),
    "expediente" TEXT,
    "actor" TEXT,
    "demandado" TEXT,
    "objeto" TEXT,
    "magistrados" TEXT,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "observacionesInternas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sentencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sumario" (
    "id" SERIAL NOT NULL,
    "legacyId" TEXT,
    "numeroSumario" TEXT,
    "tema" TEXT,
    "texto" TEXT NOT NULL,
    "resumenBusqueda" TEXT,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "sentenciaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sumario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchivoPdf" (
    "id" SERIAL NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "nombreOriginal" TEXT,
    "rutaArchivo" TEXT NOT NULL,
    "legacyPath" TEXT,
    "mimeType" TEXT,
    "tamanioBytes" INTEGER,
    "sentenciaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchivoPdf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rol_nombre_key" ON "Rol"("nombre");

-- CreateIndex
CREATE INDEX "Rol_nombre_idx" ON "Rol"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_email_idx" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_activo_idx" ON "Usuario"("activo");

-- CreateIndex
CREATE INDEX "Usuario_rolId_idx" ON "Usuario"("rolId");

-- CreateIndex
CREATE UNIQUE INDEX "Sentencia_legacyId_key" ON "Sentencia"("legacyId");

-- CreateIndex
CREATE INDEX "Sentencia_fecha_idx" ON "Sentencia"("fecha");

-- CreateIndex
CREATE INDEX "Sentencia_sala_idx" ON "Sentencia"("sala");

-- CreateIndex
CREATE INDEX "Sentencia_tipoFallo_idx" ON "Sentencia"("tipoFallo");

-- CreateIndex
CREATE INDEX "Sentencia_publicado_idx" ON "Sentencia"("publicado");

-- CreateIndex
CREATE INDEX "Sentencia_activo_idx" ON "Sentencia"("activo");

-- CreateIndex
CREATE INDEX "Sentencia_expediente_idx" ON "Sentencia"("expediente");

-- CreateIndex
CREATE INDEX "Sentencia_numeroSentencia_idx" ON "Sentencia"("numeroSentencia");

-- CreateIndex
CREATE UNIQUE INDEX "Sumario_legacyId_key" ON "Sumario"("legacyId");

-- CreateIndex
CREATE INDEX "Sumario_tema_idx" ON "Sumario"("tema");

-- CreateIndex
CREATE INDEX "Sumario_publicado_idx" ON "Sumario"("publicado");

-- CreateIndex
CREATE INDEX "Sumario_activo_idx" ON "Sumario"("activo");

-- CreateIndex
CREATE INDEX "Sumario_sentenciaId_idx" ON "Sumario"("sentenciaId");

-- CreateIndex
CREATE INDEX "ArchivoPdf_sentenciaId_idx" ON "ArchivoPdf"("sentenciaId");

-- CreateIndex
CREATE INDEX "ArchivoPdf_legacyPath_idx" ON "ArchivoPdf"("legacyPath");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sumario" ADD CONSTRAINT "Sumario_sentenciaId_fkey" FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchivoPdf" ADD CONSTRAINT "ArchivoPdf_sentenciaId_fkey" FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the `Voz` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Voz";

-- CreateTable
CREATE TABLE "DocDependencias" (
    "idDocAsociado" INTEGER NOT NULL,
    "idDependenciaAsociada" INTEGER NOT NULL,

    CONSTRAINT "DocDependencias_pkey" PRIMARY KEY ("idDocAsociado","idDependenciaAsociada")
);

-- CreateTable
CREATE TABLE "Dependencia" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "Dependencia_pkey" PRIMARY KEY ("id")
);

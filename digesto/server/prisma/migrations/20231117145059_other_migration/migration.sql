/*
  Warnings:

  - Made the column `idDocAsociado` on table `Doc` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Doc" DROP CONSTRAINT "Doc_idDocAsociado_fkey";

-- AlterTable
ALTER TABLE "Doc" ALTER COLUMN "idDocAsociado" SET NOT NULL;

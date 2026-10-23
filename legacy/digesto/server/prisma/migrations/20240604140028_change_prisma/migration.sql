/*
  Warnings:

  - Changed the type of `tipo` on the `Doc` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Doc" DROP COLUMN "tipo",
ADD COLUMN     "tipo" INTEGER NOT NULL;

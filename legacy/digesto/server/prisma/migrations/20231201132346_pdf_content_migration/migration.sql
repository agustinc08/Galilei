/*
  Warnings:

  - Added the required column `pdfContent` to the `Doc` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Doc" ADD COLUMN     "pdfContent" TEXT NOT NULL;

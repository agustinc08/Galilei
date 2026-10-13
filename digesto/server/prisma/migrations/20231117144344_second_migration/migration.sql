-- AlterTable
ALTER TABLE "Doc" ALTER COLUMN "idDocAsociado" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Doc" ADD CONSTRAINT "Doc_idDocAsociado_fkey" FOREIGN KEY ("idDocAsociado") REFERENCES "Doc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

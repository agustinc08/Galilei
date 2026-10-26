ALTER TABLE "BusquedaGuardada"
  ADD COLUMN "lastViewedAt" TIMESTAMP(3),
  ADD COLUMN "lastEvaluatedAt" TIMESTAMP(3),
  ADD COLUMN "lastNewCount" INTEGER NOT NULL DEFAULT 0;

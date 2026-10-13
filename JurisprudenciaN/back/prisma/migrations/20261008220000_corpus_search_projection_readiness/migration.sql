-- Search may use CorpusSearchToken only after the first idempotent backfill and
-- consistency check have completed. Until then the adapter keeps its exact
-- document-text candidate path, avoiding partial projection results.
CREATE TABLE "CorpusSearchTokenProjectionControl" (
  "singleton" BOOLEAN NOT NULL DEFAULT TRUE,
  "isReady" BOOLEAN NOT NULL DEFAULT FALSE,
  "verifiedAt" TIMESTAMP(3),
  CONSTRAINT "CorpusSearchTokenProjectionControl_pkey" PRIMARY KEY ("singleton"),
  CONSTRAINT "CorpusSearchTokenProjectionControl_singleton_check" CHECK ("singleton" = TRUE)
);

INSERT INTO "CorpusSearchTokenProjectionControl" ("singleton", "isReady", "verifiedAt")
VALUES (TRUE, FALSE, NULL);

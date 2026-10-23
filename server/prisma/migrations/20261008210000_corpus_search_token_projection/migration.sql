-- Compact read model for exact substring candidate generation. Each token is
-- already normalized by the Corpus ingestion path; source text remains owned
-- by CorpusDocument and is never duplicated into the search result model.
CREATE TABLE "CorpusSearchToken" (
  "id" BIGSERIAL NOT NULL,
  "documentId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  CONSTRAINT "CorpusSearchToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusSearchToken_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CorpusSearchToken_documentId_idx"
  ON "CorpusSearchToken"("documentId");
CREATE INDEX "CorpusSearchToken_token_trgm_idx"
  ON "CorpusSearchToken" USING GIN ("token" gin_trgm_ops);

CREATE TABLE "CorpusSearchTokenState" (
  "documentId" TEXT NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusSearchTokenState_pkey" PRIMARY KEY ("documentId"),
  CONSTRAINT "CorpusSearchTokenState_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "CorpusDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE FUNCTION "refreshCorpusSearchTokens"(target_document_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_text TEXT;
  inserted_count INTEGER;
BEGIN
  SELECT "searchText" INTO source_text
    FROM "CorpusDocument"
   WHERE "id" = target_document_id
   FOR UPDATE;

  IF NOT FOUND THEN
    DELETE FROM "CorpusSearchToken" WHERE "documentId" = target_document_id;
    DELETE FROM "CorpusSearchTokenState" WHERE "documentId" = target_document_id;
    RETURN 0;
  END IF;

  DELETE FROM "CorpusSearchToken" WHERE "documentId" = target_document_id;
  INSERT INTO "CorpusSearchToken" ("documentId", "token")
  SELECT target_document_id, tokens."token"
    FROM (
      SELECT DISTINCT split.value AS "token"
        FROM regexp_split_to_table(COALESCE(source_text, ''), '[[:space:]]+') AS split(value)
       WHERE split.value <> ''
    ) tokens;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  INSERT INTO "CorpusSearchTokenState" ("documentId", "sourceChecksum", "tokenCount", "updatedAt")
  VALUES (target_document_id, md5(COALESCE(source_text, '')), inserted_count, CURRENT_TIMESTAMP)
  ON CONFLICT ("documentId") DO UPDATE SET
    "sourceChecksum" = EXCLUDED."sourceChecksum",
    "tokenCount" = EXCLUDED."tokenCount",
    "updatedAt" = EXCLUDED."updatedAt";
  RETURN inserted_count;
END;
$$;

CREATE FUNCTION "syncCorpusSearchTokens"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "refreshCorpusSearchTokens"(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CorpusDocument_sync_search_tokens"
AFTER INSERT OR UPDATE OF "searchText" ON "CorpusDocument"
FOR EACH ROW EXECUTE FUNCTION "syncCorpusSearchTokens"();

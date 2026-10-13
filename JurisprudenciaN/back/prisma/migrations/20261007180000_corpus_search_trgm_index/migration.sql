-- Supports Corpus ILIKE contains search for terms long enough to produce trigrams.
CREATE INDEX "CorpusDocument_searchText_trgm_idx"
  ON "CorpusDocument" USING GIN ("searchText" gin_trgm_ops)
  WHERE "status" = 'INDEXED';

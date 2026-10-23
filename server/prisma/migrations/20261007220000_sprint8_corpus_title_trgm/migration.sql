-- Match the normalized title expression used by Corpus field searches.
CREATE INDEX "CorpusDocument_title_normalized_trgm_idx"
  ON "CorpusDocument"
  USING GIN (
    translate(lower(coalesce("title", '')), 'áéíóúü', 'aeiouu') gin_trgm_ops
  );

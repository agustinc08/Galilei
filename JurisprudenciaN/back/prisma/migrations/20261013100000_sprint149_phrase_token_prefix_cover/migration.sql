-- Cover normalized prefix lookups for the final token in a multiword phrase.
-- The corresponding lower(token) LIKE 'prefix%' predicate can use this
-- pattern-ops index and return documentId without fetching random heap pages.
CREATE INDEX "CorpusSearchToken_token_prefix_cover_idx"
  ON "CorpusSearchToken" (lower("token") text_pattern_ops)
  INCLUDE ("documentId");

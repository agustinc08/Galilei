-- The page-text GIN index was experimentally rejected: common-term plans visited
-- about 20,000 page tuples and remained slower than the existing document GIN.
DROP INDEX "CorpusDocumentPage_text_search_trgm_idx";

-- Let ordered result queries stop once the first matching indexed documents are found.
CREATE INDEX "CorpusDocument_indexed_search_order_idx"
ON "CorpusDocument" ("decisionDate" DESC NULLS LAST, "updatedAt" DESC, "id" ASC)
WHERE "status" = 'INDEXED';

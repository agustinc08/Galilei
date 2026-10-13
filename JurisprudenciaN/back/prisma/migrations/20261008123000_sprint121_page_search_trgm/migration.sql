-- Keep generic corpus term and phrase search on page-sized text values.
-- CorpusDocument.searchText contains the entire extracted body and routinely
-- exceeds 60 KB; indexing each page makes the GIN heap rechecks much smaller.
CREATE INDEX "CorpusDocumentPage_text_search_trgm_idx"
ON "CorpusDocumentPage"
USING GIN (translate(lower(coalesce("text", '')), 'áéíóúü', 'aeiouu') gin_trgm_ops);

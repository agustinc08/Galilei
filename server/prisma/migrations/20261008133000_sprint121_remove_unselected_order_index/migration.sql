-- The ordered index was evaluated with EXPLAIN but PostgreSQL selected the
-- existing trigram plan; the ordered index had no measured use and is removed.
DROP INDEX "CorpusDocument_indexed_search_order_idx";

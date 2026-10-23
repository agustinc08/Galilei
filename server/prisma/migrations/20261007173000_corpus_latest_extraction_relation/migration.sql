ALTER TABLE "CorpusDocument"
  ADD CONSTRAINT "CorpusDocument_latestExtractionId_fkey"
  FOREIGN KEY ("latestExtractionId") REFERENCES "CorpusExtraction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

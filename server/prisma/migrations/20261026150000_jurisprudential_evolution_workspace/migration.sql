CREATE TABLE "ResearchTimeline" (
  "id" SERIAL NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchTimeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchTimelineItem" (
  "id" SERIAL NOT NULL,
  "timelineId" INTEGER NOT NULL,
  "sentenciaId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchTimelineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResearchTimeline_ownerId_updatedAt_idx"
  ON "ResearchTimeline"("ownerId", "updatedAt");

CREATE UNIQUE INDEX "ResearchTimelineItem_timelineId_sentenciaId_key"
  ON "ResearchTimelineItem"("timelineId", "sentenciaId");

CREATE INDEX "ResearchTimelineItem_timelineId_idx"
  ON "ResearchTimelineItem"("timelineId");

CREATE INDEX "ResearchTimelineItem_sentenciaId_idx"
  ON "ResearchTimelineItem"("sentenciaId");

ALTER TABLE "ResearchTimeline"
  ADD CONSTRAINT "ResearchTimeline_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchTimelineItem"
  ADD CONSTRAINT "ResearchTimelineItem_timelineId_fkey"
  FOREIGN KEY ("timelineId") REFERENCES "ResearchTimeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchTimelineItem"
  ADD CONSTRAINT "ResearchTimelineItem_sentenciaId_fkey"
  FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Match the SQL normalization used by the modern field candidate planner.
-- These are read-model indexes; source columns remain authoritative.
CREATE INDEX "idx_sumario_tema_search_norm_trgm"
  ON "Sumario" USING GIN (
    regexp_replace(
      translate(lower(coalesce("tema", '')), 'áéíóúü', 'aeiouu'),
      '[^[:alnum:]ñ/.-]+', ' ', 'g'
    ) gin_trgm_ops
  );

CREATE INDEX "idx_sumario_numero_search_norm_trgm"
  ON "Sumario" USING GIN (
    regexp_replace(
      translate(lower(coalesce("numeroSumario", '')), 'áéíóúü', 'aeiouu'),
      '[^[:alnum:]ñ/.-]+', ' ', 'g'
    ) gin_trgm_ops
  );

CREATE INDEX "idx_sentencia_sala_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("sala", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_tipo_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("tipoFallo", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_tribunal_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("tribunalOrigen", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_expediente_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("expediente", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_caratula_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("caratula", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_actor_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("actor", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_demandado_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("demandado", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_objeto_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("objeto", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_magistrados_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("magistrados", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );
CREATE INDEX "idx_sentencia_numero_search_norm_trgm"
  ON "Sentencia" USING GIN (
    regexp_replace(translate(lower(coalesce("numeroSentencia", '')), 'áéíóúü', 'aeiouu'), '[^[:alnum:]ñ/.-]+', ' ', 'g') gin_trgm_ops
  );

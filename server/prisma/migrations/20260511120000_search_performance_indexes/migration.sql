CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_sentencia_publicado_activo_fecha"
  ON "Sentencia" ("publicado", "activo", "fecha" DESC);

CREATE INDEX IF NOT EXISTS "idx_sentencia_publicado_activo_tiene_pdf"
  ON "Sentencia" ("publicado", "activo", "tienePdf");

CREATE INDEX IF NOT EXISTS "idx_sentencia_sala_fecha"
  ON "Sentencia" ("sala", "fecha" DESC);

CREATE INDEX IF NOT EXISTS "idx_sentencia_tipo_fallo_fecha"
  ON "Sentencia" ("tipoFallo", "fecha" DESC);

CREATE INDEX IF NOT EXISTS "idx_sentencia_tribunal_origen_fecha"
  ON "Sentencia" ("tribunalOrigen", "fecha" DESC);

CREATE INDEX IF NOT EXISTS "idx_sentencia_numero_sentencia_trgm"
  ON "Sentencia" USING GIN ("numeroSentencia" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sentencia_expediente_trgm"
  ON "Sentencia" USING GIN ("expediente" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sentencia_caratula_trgm"
  ON "Sentencia" USING GIN ("caratula" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sentencia_magistrados_trgm"
  ON "Sentencia" USING GIN ("magistrados" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sentencia_texto_busqueda_norm_trgm"
  ON "Sentencia" USING GIN ("textoBusquedaNormalizado" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sumario_publicado_activo_sentencia"
  ON "Sumario" ("publicado", "activo", "sentenciaId");

CREATE INDEX IF NOT EXISTS "idx_sumario_numero_sumario_trgm"
  ON "Sumario" USING GIN ("numeroSumario" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sumario_tema_trgm"
  ON "Sumario" USING GIN ("tema" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sumario_texto_trgm"
  ON "Sumario" USING GIN ("texto" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_sumario_texto_busqueda_norm_trgm"
  ON "Sumario" USING GIN ("textoBusquedaNormalizado" gin_trgm_ops);

ALTER TABLE "Sentencia"
ADD COLUMN "resumenIa" TEXT,
ADD COLUMN "resena" TEXT,
ADD COLUMN "resenaPublicada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resenaUpdatedAt" TIMESTAMP(3),
ADD COLUMN "resenaPublicadaAt" TIMESTAMP(3),
ADD COLUMN "resenaUpdatedById" INTEGER,
ADD COLUMN "resenaPublicadaById" INTEGER,
ADD COLUMN "actorOriginal" TEXT,
ADD COLUMN "demandadoOriginal" TEXT,
ADD COLUMN "actorPublico" TEXT,
ADD COLUMN "demandadoPublico" TEXT,
ADD COLUMN "anonimizado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resumenPublicado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "resumenFuente" TEXT,
ADD COLUMN "citaPersonalizada" TEXT,
ADD COLUMN "slugPublico" TEXT,
ADD COLUMN "destacada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "textoBusqueda" TEXT,
ADD COLUMN "textoBusquedaNormalizado" TEXT,
ADD COLUMN "caratula" TEXT,
ADD COLUMN "tribunalOrigen" TEXT,
ADD COLUMN "anio" INTEGER,
ADD COLUMN "estadoCarga" TEXT NOT NULL DEFAULT 'BORRADOR',
ADD COLUMN "tienePdf" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Sumario"
ADD COLUMN "textoBusqueda" TEXT,
ADD COLUMN "textoBusquedaNormalizado" TEXT;

CREATE TABLE "CitaFallo" (
    "id" SERIAL NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "textoOriginal" TEXT,
    "contexto" TEXT,
    "pagina" INTEGER,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "creadaManual" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitaFallo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sentencia_slugPublico_key" ON "Sentencia"("slugPublico");
CREATE INDEX "Sentencia_destacada_idx" ON "Sentencia"("destacada");
CREATE INDEX "Sentencia_slugPublico_idx" ON "Sentencia"("slugPublico");
CREATE INDEX "Sentencia_caratula_idx" ON "Sentencia"("caratula");
CREATE INDEX "Sentencia_anio_idx" ON "Sentencia"("anio");
CREATE INDEX "Sentencia_tienePdf_idx" ON "Sentencia"("tienePdf");
CREATE INDEX "Sentencia_actor_idx" ON "Sentencia"("actor");
CREATE INDEX "Sentencia_demandado_idx" ON "Sentencia"("demandado");
CREATE INDEX "Sentencia_publicado_fecha_idx" ON "Sentencia"("publicado", "fecha");
CREATE INDEX "Sentencia_activo_fecha_idx" ON "Sentencia"("activo", "fecha");
CREATE INDEX "Sentencia_sala_fecha_idx" ON "Sentencia"("sala", "fecha");
CREATE INDEX "Sentencia_tipoFallo_fecha_idx" ON "Sentencia"("tipoFallo", "fecha");
CREATE INDEX "Sentencia_anonimizado_idx" ON "Sentencia"("anonimizado");
CREATE INDEX "Sentencia_estadoCarga_idx" ON "Sentencia"("estadoCarga");
CREATE INDEX "Sumario_numeroSumario_idx" ON "Sumario"("numeroSumario");
CREATE INDEX "Sumario_sentenciaId_publicado_idx" ON "Sumario"("sentenciaId", "publicado");
CREATE INDEX "Sumario_sentenciaId_activo_idx" ON "Sumario"("sentenciaId", "activo");
CREATE UNIQUE INDEX "CitaFallo_sentenciaId_tipo_referencia_key" ON "CitaFallo"("sentenciaId", "tipo", "referencia");
CREATE INDEX "CitaFallo_sentenciaId_idx" ON "CitaFallo"("sentenciaId");
CREATE INDEX "CitaFallo_tipo_idx" ON "CitaFallo"("tipo");
CREATE INDEX "CitaFallo_referencia_idx" ON "CitaFallo"("referencia");
CREATE INDEX "CitaFallo_confirmada_idx" ON "CitaFallo"("confirmada");

CREATE TABLE "ReferenciaNormativa" (
    "id" SERIAL NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "normaArticuloId" INTEGER,
    "tipoNorma" TEXT NOT NULL,
    "numeroNorma" TEXT,
    "articulo" TEXT,
    "inciso" TEXT,
    "textoReferencia" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenciaNormativa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferenciaNormativa_sentenciaId_idx" ON "ReferenciaNormativa"("sentenciaId");
CREATE INDEX "ReferenciaNormativa_tipoNorma_idx" ON "ReferenciaNormativa"("tipoNorma");
CREATE INDEX "ReferenciaNormativa_normaArticuloId_idx" ON "ReferenciaNormativa"("normaArticuloId");

CREATE TABLE "ReferenciaJurisprudencial" (
    "id" SERIAL NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "referencia" TEXT NOT NULL,
    "falloRelacionadoId" INTEGER,
    "textoOriginal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenciaJurisprudencial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferenciaJurisprudencial_sentenciaId_idx" ON "ReferenciaJurisprudencial"("sentenciaId");
CREATE INDEX "ReferenciaJurisprudencial_falloRelacionadoId_idx" ON "ReferenciaJurisprudencial"("falloRelacionadoId");

CREATE TABLE "ReferenciaDoctrinaria" (
    "id" SERIAL NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "autor" TEXT,
    "titulo" TEXT,
    "fuente" TEXT,
    "anio" INTEGER,
    "textoReferencia" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenciaDoctrinaria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferenciaDoctrinaria_sentenciaId_idx" ON "ReferenciaDoctrinaria"("sentenciaId");
CREATE INDEX "ReferenciaDoctrinaria_autor_idx" ON "ReferenciaDoctrinaria"("autor");
CREATE INDEX "ReferenciaDoctrinaria_anio_idx" ON "ReferenciaDoctrinaria"("anio");

CREATE TABLE "Favorito" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "sentenciaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorito_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusquedaGuardada" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "queryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusquedaGuardada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorito_usuarioId_sentenciaId_key" ON "Favorito"("usuarioId", "sentenciaId");
CREATE INDEX "Favorito_usuarioId_idx" ON "Favorito"("usuarioId");
CREATE INDEX "Favorito_sentenciaId_idx" ON "Favorito"("sentenciaId");
CREATE INDEX "BusquedaGuardada_usuarioId_idx" ON "BusquedaGuardada"("usuarioId");

ALTER TABLE "Favorito"
ADD CONSTRAINT "Favorito_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Favorito"
ADD CONSTRAINT "Favorito_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusquedaGuardada"
ADD CONSTRAINT "BusquedaGuardada_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CitaFallo"
ADD CONSTRAINT "CitaFallo_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sentencia"
ADD CONSTRAINT "Sentencia_resenaUpdatedById_fkey"
FOREIGN KEY ("resenaUpdatedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sentencia"
ADD CONSTRAINT "Sentencia_resenaPublicadaById_fkey"
FOREIGN KEY ("resenaPublicadaById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CitaFallo"
ADD CONSTRAINT "CitaFallo_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CitaFallo"
ADD CONSTRAINT "CitaFallo_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReferenciaNormativa"
ADD CONSTRAINT "ReferenciaNormativa_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstitutoJuridico" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutoJuridico_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstitutoJuridico_nombre_key" ON "InstitutoJuridico"("nombre");
CREATE INDEX "InstitutoJuridico_nombre_idx" ON "InstitutoJuridico"("nombre");

CREATE TABLE "SinonimoJuridico" (
    "id" SERIAL NOT NULL,
    "institutoId" INTEGER NOT NULL,
    "termino" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SinonimoJuridico_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SinonimoJuridico_institutoId_termino_key" ON "SinonimoJuridico"("institutoId", "termino");
CREATE INDEX "SinonimoJuridico_institutoId_idx" ON "SinonimoJuridico"("institutoId");
CREATE INDEX "SinonimoJuridico_termino_idx" ON "SinonimoJuridico"("termino");

CREATE TABLE "NormaArticulo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "numeroNorma" TEXT,
    "articulo" TEXT NOT NULL,
    "titulo" TEXT,
    "texto" TEXT,
    "url" TEXT,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormaArticulo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NormaArticulo_codigo_idx" ON "NormaArticulo"("codigo");
CREATE INDEX "NormaArticulo_articulo_idx" ON "NormaArticulo"("articulo");
CREATE INDEX "NormaArticulo_numeroNorma_idx" ON "NormaArticulo"("numeroNorma");

CREATE TABLE "EquivalenciaNormativa" (
    "id" SERIAL NOT NULL,
    "articuloOrigenId" INTEGER NOT NULL,
    "articuloDestinoId" INTEGER NOT NULL,
    "tipoRelacion" TEXT NOT NULL,
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquivalenciaNormativa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquivalenciaNormativa_articuloOrigenId_articuloDestinoId_tipoRelacion_key" ON "EquivalenciaNormativa"("articuloOrigenId", "articuloDestinoId", "tipoRelacion");
CREATE INDEX "EquivalenciaNormativa_articuloOrigenId_idx" ON "EquivalenciaNormativa"("articuloOrigenId");
CREATE INDEX "EquivalenciaNormativa_articuloDestinoId_idx" ON "EquivalenciaNormativa"("articuloDestinoId");

ALTER TABLE "SinonimoJuridico"
ADD CONSTRAINT "SinonimoJuridico_institutoId_fkey"
FOREIGN KEY ("institutoId") REFERENCES "InstitutoJuridico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferenciaNormativa"
ADD CONSTRAINT "ReferenciaNormativa_normaArticuloId_fkey"
FOREIGN KEY ("normaArticuloId") REFERENCES "NormaArticulo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EquivalenciaNormativa"
ADD CONSTRAINT "EquivalenciaNormativa_articuloOrigenId_fkey"
FOREIGN KEY ("articuloOrigenId") REFERENCES "NormaArticulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquivalenciaNormativa"
ADD CONSTRAINT "EquivalenciaNormativa_articuloDestinoId_fkey"
FOREIGN KEY ("articuloDestinoId") REFERENCES "NormaArticulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferenciaJurisprudencial"
ADD CONSTRAINT "ReferenciaJurisprudencial_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferenciaJurisprudencial"
ADD CONSTRAINT "ReferenciaJurisprudencial_falloRelacionadoId_fkey"
FOREIGN KEY ("falloRelacionadoId") REFERENCES "Sentencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReferenciaDoctrinaria"
ADD CONSTRAINT "ReferenciaDoctrinaria_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventoConsulta" (
    "id" SERIAL NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "usuarioId" INTEGER,
    "sentenciaId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoConsulta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventoConsulta_tipoEvento_createdAt_idx" ON "EventoConsulta"("tipoEvento", "createdAt");
CREATE INDEX "EventoConsulta_sentenciaId_tipoEvento_idx" ON "EventoConsulta"("sentenciaId", "tipoEvento");
CREATE INDEX "EventoConsulta_usuarioId_createdAt_idx" ON "EventoConsulta"("usuarioId", "createdAt");

ALTER TABLE "EventoConsulta"
ADD CONSTRAINT "EventoConsulta_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventoConsulta"
ADD CONSTRAINT "EventoConsulta_sentenciaId_fkey"
FOREIGN KEY ("sentenciaId") REFERENCES "Sentencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AccionLog" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" INTEGER,
    "accion" TEXT NOT NULL,
    "descripcion" TEXT,
    "datosAntes" JSONB,
    "datosDespues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccionLog_usuarioId_idx" ON "AccionLog"("usuarioId");
CREATE INDEX "AccionLog_entidad_idx" ON "AccionLog"("entidad");
CREATE INDEX "AccionLog_entidadId_idx" ON "AccionLog"("entidadId");
CREATE INDEX "AccionLog_accion_idx" ON "AccionLog"("accion");
CREATE INDEX "AccionLog_createdAt_idx" ON "AccionLog"("createdAt");

ALTER TABLE "AccionLog"
ADD CONSTRAINT "AccionLog_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

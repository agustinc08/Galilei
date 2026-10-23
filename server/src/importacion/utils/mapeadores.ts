import {
  normalizeLegacyExpediente,
  normalizeBoolean,
  normalizeLegacyId,
  normalizeNullableString,
  parseLegacyDate,
} from './normalizadores';
import {
  buildSentenciaSearchData,
  buildSumarioSearchData,
} from '../../busqueda/utils/search-normalizer';

export type LegacyRow = Record<string, unknown>;

type Accessor = {
  get: (...candidates: string[]) => unknown;
  hasAny: (...candidates: string[]) => boolean;
};

const SENTENCIA_COLUMNS = {
  legacyId: ['id_sentencia', 'idsentencia', 'id', 'codigo'],
  numeroSentencia: ['codigo_sentencia', 'numerosentencia', 'numero_sentencia', 'nro_sentencia'],
  tipoFallo: ['tipofallo', 'tipo_fallo', 'fallo', 'tipo'],
  sala: ['sala', 'camara', 'tribunal'],
  fecha: ['fecha', 'fecha_sentencia', 'fecha_fallo'],
  expediente: ['nro_expte', 'expediente', 'nro_expediente', 'numero_expediente'],
  juez: ['juez', 'jueza'],
  tribunalOrigen: ['tribunal_origen', 'tribunalorigen', 'juzgado_origen'],
  actor: ['actor', 'caratula_actor', 'demandante'],
  demandado: ['demandado', 'caratula_demandado', 'demandada'],
  objeto: ['objeto', 'materia', 'descripcion'],
  magistrados: ['magistrados', 'jueces', 'firmantes'],
  publicado: ['publicado', 'publica', 'visible', 'estado_publicado'],
  publicarSentencia: ['publicarsentencia', 'publicar_sentencia'],
  activo: ['activo', 'activa', 'estado', 'habilitado'],
  falloCompleto: ['fallo_completo', 'fallocompleto'],
  legacyLink: ['link', 'url', 'enlace'],
  observacionesInternas: ['observacionesinternas', 'observaciones', 'notas'],
  pdf: [
    'archivo',
    'archivo_pdf',
    'pdf',
    'rutaarchivo',
    'ruta_archivo',
    'ruta_pdf',
    'path_pdf',
    'nombrearchivo',
    'nombre_archivo',
  ],
} as const;

const SUMARIO_COLUMNS = {
  legacyId: ['codigo', 'id', 'id_sumario', 'idsumario', 'codigo_sumario'],
  sentenciaLegacyId: [
    'sentenciaid',
    'sentencia_id',
    'id_sentencia',
    'codigo_sentencia',
    'tb_sentencias_id',
    'codsentencia',
  ],
  numeroSumario: ['numerosumario', 'numero_sumario', 'nro_sumario'],
  tema: ['tema', 'titulo', 'materia'],
  texto: ['texto', 'contenido', 'sumario', 'descripcion'],
  resumenBusqueda: [
    'resumenbusqueda',
    'resumen_busqueda',
    'resumen',
    'busqueda',
  ],
  publicado: ['publicado', 'publica', 'visible', 'estado_publicado'],
  publicarSumario: ['publicarsumario', 'publicar_sumario'],
  activo: ['activo', 'activa', 'estado', 'habilitado'],
} as const;

export function createAccessor(row: LegacyRow): Accessor {
  const map = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    map.set(key.toLowerCase(), value);
  }

  return {
    get: (...candidates: string[]) => {
      for (const candidate of candidates) {
        if (map.has(candidate.toLowerCase())) {
          return map.get(candidate.toLowerCase());
        }
      }
      return undefined;
    },
    hasAny: (...candidates: string[]) =>
      candidates.some((candidate) => map.has(candidate.toLowerCase())),
  };
}

export function mapLegacySentencia(row: LegacyRow) {
  const accessor = createAccessor(row);
  const legacyId = normalizeLegacyId(
    accessor.get(...SENTENCIA_COLUMNS.legacyId),
  );
  const numeroSentencia = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.numeroSentencia),
  );
  const fechaRaw = accessor.get(...SENTENCIA_COLUMNS.fecha);
  const fecha = parseLegacyDate(fechaRaw);
  const tipoFallo = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.tipoFallo),
  );
  const sala = normalizeNullableString(accessor.get(...SENTENCIA_COLUMNS.sala));
  const expediente = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.expediente),
  );
  const tribunalOrigen = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.tribunalOrigen),
  );
  const actor = normalizeNullableString(accessor.get(...SENTENCIA_COLUMNS.actor));
  const demandado = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.demandado),
  );
  const objeto = normalizeNullableString(accessor.get(...SENTENCIA_COLUMNS.objeto));
  const juez = normalizeNullableString(accessor.get(...SENTENCIA_COLUMNS.juez));
  const magistrados =
    normalizeNullableString(accessor.get(...SENTENCIA_COLUMNS.magistrados)) ??
    juez;
  const falloCompletoRaw = accessor.get(...SENTENCIA_COLUMNS.falloCompleto);
  const explicitPdfValue = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.pdf),
  );
  const falloCompletoPath =
    typeof falloCompletoRaw === 'string' && !['0', '1'].includes(falloCompletoRaw.trim())
      ? normalizeNullableString(falloCompletoRaw)
      : undefined;
  const legacyLink = normalizeNullableString(
    accessor.get(...SENTENCIA_COLUMNS.legacyLink),
  );
  const explicitPdfPath =
    explicitPdfValue ??
    falloCompletoPath ??
    legacyLink;
  const publicado = accessor.hasAny(...SENTENCIA_COLUMNS.publicarSentencia)
    ? normalizeBoolean(accessor.get(...SENTENCIA_COLUMNS.publicarSentencia), true)
    : normalizeBoolean(accessor.get(...SENTENCIA_COLUMNS.publicado), true);
  const activo = normalizeBoolean(accessor.get(...SENTENCIA_COLUMNS.activo), true);
  const tienePdf =
    Boolean(explicitPdfPath) ||
    normalizeBoolean(falloCompletoRaw, false);
  const searchData = buildSentenciaSearchData({
    numeroSentencia,
    tipoFallo,
    sala,
    expediente,
    tribunalOrigen,
    actor,
    demandado,
    objeto,
    magistrados,
    caratula: normalizeNullableString(
      [actor, demandado].filter(Boolean).join(' c/ '),
    ),
    fecha,
  });

  return {
    legacyId,
    data: {
      legacyId,
      legacyLink,
      numeroSentencia,
      tipoFallo,
      sala,
      fecha,
      expediente,
      tribunalOrigen,
      actor,
      demandado,
      objeto,
      magistrados,
      publicado,
      activo,
      estadoCarga: publicado && activo ? 'PUBLICADA' : 'BORRADOR',
      tienePdf,
      observacionesInternas: normalizeNullableString(
        accessor.get(...SENTENCIA_COLUMNS.observacionesInternas),
      ),
      ...searchData,
    },
    fechaRaw,
    expedienteNormalizado: normalizeLegacyExpediente(expediente),
    juez,
    sala,
    tipoFallo,
    tribunalOrigen,
    numeroSentencia,
    legacyLink,
    explicitPdfPath,
  };
}

export function mapLegacySumario(row: LegacyRow) {
  const accessor = createAccessor(row);
  const legacyId = normalizeLegacyId(accessor.get(...SUMARIO_COLUMNS.legacyId));
  const tema = normalizeNullableString(accessor.get(...SUMARIO_COLUMNS.tema));
  const texto = normalizeNullableString(accessor.get(...SUMARIO_COLUMNS.texto));
  const numeroSumario = normalizeNullableString(
    accessor.get(...SUMARIO_COLUMNS.numeroSumario),
  );
  const resumenBusqueda = normalizeNullableString(
    accessor.get(...SUMARIO_COLUMNS.resumenBusqueda),
  );
  const searchData = buildSumarioSearchData({
    numeroSumario,
    tema,
    texto,
    resumenBusqueda,
  });
  const publicado = accessor.hasAny(...SUMARIO_COLUMNS.publicarSumario)
    ? normalizeBoolean(accessor.get(...SUMARIO_COLUMNS.publicarSumario), true)
    : normalizeBoolean(accessor.get(...SUMARIO_COLUMNS.publicado), true);

  return {
    legacyId,
    sentenciaLegacyId: normalizeLegacyId(
      accessor.get(...SUMARIO_COLUMNS.sentenciaLegacyId),
    ),
    data: {
      legacyId,
      numeroSumario,
      tema,
      texto: texto ?? '',
      resumenBusqueda: searchData.resumenBusqueda,
      textoBusqueda: searchData.textoBusqueda,
      textoBusquedaNormalizado: searchData.textoBusquedaNormalizado,
      publicado,
      activo: normalizeBoolean(accessor.get(...SUMARIO_COLUMNS.activo), true),
    },
  };
}

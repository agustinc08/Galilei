const ENYE_SENTINEL = '\uE000';

/** Removes Spanish vowel accents while keeping ñ distinct from n. */
export function normalizeSpanishText(value: string) {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/n\u0303/gu, ENYE_SENTINEL)
    .replace(/\p{Diacritic}/gu, '')
    .replace(new RegExp(ENYE_SENTINEL, 'gu'), 'ñ')
    .normalize('NFC');
}

export function normalizeQueryText(value: string) {
  return normalizeSpanishText(value).replace(/\s+/gu, ' ').trim();
}

export function normalizeSearchText(...parts: Array<string | null | undefined>) {
  return normalizeSpanishText(
    parts
      .filter((part): part is string => Boolean(part?.trim()))
      .join(' '),
  )
    .replace(/[^\p{L}\p{N}\s/.-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function buildSearchText(...parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCaratula(
  actor?: string | null,
  demandado?: string | null,
) {
  const actorValue = actor?.trim();
  const demandadoValue = demandado?.trim();

  if (!actorValue && !demandadoValue) {
    return null;
  }

  if (!actorValue) {
    return demandadoValue ?? null;
  }

  if (!demandadoValue) {
    return actorValue;
  }

  return `${actorValue} c/ ${demandadoValue}`;
}

export function extractYear(value?: Date | null) {
  if (!value) {
    return null;
  }

  return value.getUTCFullYear();
}

export function buildSentenciaSearchData(input: {
  numeroSentencia?: string | null;
  tipoFallo?: string | null;
  sala?: string | null;
  expediente?: string | null;
  tribunalOrigen?: string | null;
  actor?: string | null;
  demandado?: string | null;
  objeto?: string | null;
  magistrados?: string | null;
  resumenIa?: string | null;
  resena?: string | null;
  citaPersonalizada?: string | null;
  caratula?: string | null;
  fecha?: Date | null;
}) {
  const caratula =
    input.caratula?.trim() || buildCaratula(input.actor, input.demandado);
  const textoBusqueda = buildSearchText(
    input.numeroSentencia,
    input.tipoFallo,
    input.sala,
    input.expediente,
    input.tribunalOrigen,
    input.actor,
    input.demandado,
    input.objeto,
    input.magistrados,
    input.resumenIa,
    input.resena,
    input.citaPersonalizada,
    caratula,
  );

  return {
    caratula,
    anio: extractYear(input.fecha),
    textoBusqueda,
    textoBusquedaNormalizado: normalizeSearchText(textoBusqueda),
  };
}

export function buildSumarioSearchData(input: {
  numeroSumario?: string | null;
  tema?: string | null;
  texto?: string | null;
  resumenBusqueda?: string | null;
}) {
  const resumenBusqueda =
    input.resumenBusqueda ?? buildSearchText(input.tema, input.texto);
  const textoBusqueda = buildSearchText(
    input.numeroSumario,
    input.tema,
    input.texto,
    resumenBusqueda,
  );

  return {
    resumenBusqueda,
    textoBusqueda,
    textoBusquedaNormalizado: normalizeSearchText(textoBusqueda),
  };
}

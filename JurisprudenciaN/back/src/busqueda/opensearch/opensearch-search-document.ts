import { normalizeSearchText } from '../utils/search-normalizer';
import { sentenciaTienePdfReal } from '../../archivos/pdf-real.util';
import {
  SEARCH_FIELD_NAMES,
  SEARCH_SCOPE_NAMES,
  SEARCH_INDEX_SCHEMA_VERSION,
  SEARCH_INDEX_SCHEMA_VERSION_V4,
  lexicalTokens,
  phraseBigramSequence,
  phraseSequence,
  type SearchIndexDocument,
  type SearchIndexSchemaVersion,
  type SearchScopeField,
} from './opensearch-mapping';

export type CorpusSearchProjection = {
  id: string;
  documentType: string;
  title: string;
  subtitle: string | null;
  jurisdiction: string;
  court: string | null;
  chamber: string | null;
  instance: string | null;
  caseNumber: string | null;
  docket: string | null;
  decisionDate: Date | null;
  visibility: string;
  documentScope: string;
  status: string;
  updatedAt: Date;
  searchText: string;
  latestOriginalFilename?: string | null;
  workspaceLinkedAt?: Date | null;
  metadata: Record<string, unknown> | null;
  mimeType: string | null;
  digestoCollectionIds: string[];
  digestoTopicIds: string[];
  digestoTagIds: string[];
  aclPrincipalIds: string[];
  sourceIds: string[];
  sourcePaths: string[];
  sourceWorkspaceIds: string[];
  sourceFileScopes?: Array<{
    sourceId: string;
    workspaceId: string | null;
    normalizedPath: string | null;
  }>;
  linkedResultIds: string[];
  ownerUserId: number | null;
  workspaceId: string | null;
  folderId: string | null;
  visibilityScope: string | null;
};

export type JurisprudenciaSearchProjection = {
  id: number;
  numeroSumario: string | null;
  tema: string | null;
  texto: string;
  resumenBusqueda: string | null;
  textoBusquedaNormalizado: string | null;
  sumarioPublicado: boolean;
  sentenciaPublicado: boolean;
  sumarioActivo: boolean;
  sentenciaActivo: boolean;
  sentenciaId: number;
  legacyId: string | null;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  fecha: Date | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  actor: string | null;
  actorPublico: string | null;
  demandado: string | null;
  demandadoPublico: string | null;
  anonimizado: boolean;
  objeto: string | null;
  magistrados: string | null;
  caratula: string | null;
  sentenciaSearchText: string | null;
  updatedAt: Date;
  resumenIa?: string | null;
  resumenPublicado?: boolean;
  resena?: string | null;
  resenaPublicada?: boolean;
  destacada?: boolean;
  archivosPdf?: Array<{ id: number; rutaArchivo: string | null }>;
  referenciasSearchText?: string | null;
};

export type SentenciaSearchProjection = {
  id: number;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  fecha: Date | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  actor: string | null;
  actorPublico: string | null;
  demandado: string | null;
  demandadoPublico: string | null;
  anonimizado: boolean;
  objeto: string | null;
  magistrados: string | null;
  caratula: string | null;
  textoBusquedaNormalizado: string | null;
  sumariosSearchText: string | null;
  numeroSumarios: string[];
  publicado: boolean;
  activo: boolean;
  estadoCarga: string;
  updatedAt: Date;
  resumenIa?: string | null;
  resumenPublicado?: boolean;
  resena?: string | null;
  resenaPublicada?: boolean;
  destacada?: boolean;
  archivosPdf?: Array<{ id: number; rutaArchivo: string | null }>;
  referenciasSearchText?: string | null;
};

export function projectCorpusSearchDocument(
  row: CorpusSearchProjection,
  schemaVersion: SearchIndexSchemaVersion = SEARCH_INDEX_SCHEMA_VERSION,
): SearchIndexDocument {
  const metadata = row.metadata ?? {};
  // Preserve the pre-existing projection layout while parameterizing its schema.
  // prettier-ignore
  return finishProjection({
    id: row.id,
    sourceSystem: 'CORPUS',
    sourceType: 'DOCUMENTO',
    documentType: row.documentType,
    title: row.title,
    subtitle: row.subtitle,
    jurisdiction: row.jurisdiction,
    court: row.court,
    chamber: row.chamber,
    instance: row.instance,
    caseNumber: row.caseNumber,
    docket: row.docket,
    decisionDate: row.decisionDate?.toISOString() ?? null,
    visibility: row.visibility,
    documentScope: row.documentScope,
    status: row.status,
    active: true,
    updatedAt: row.updatedAt.toISOString(),
    canonicalSearchText: row.searchText,
    searchScopeFields: { sentencia: row.searchText },
    workspaceNameFields: {
      title: row.title,
      filename: row.latestOriginalFilename ?? null,
    },
    workspaceLinkedAt: row.workspaceLinkedAt?.toISOString() ?? null,
    sortFields: {
      sala: row.chamber,
      numeroSentencia: row.caseNumber,
    },
    fields: {
      tema: metadata.tema,
      sala: row.chamber,
      tipoFallo: row.documentType,
      tribunalOrigen: row.court,
      expediente: row.caseNumber,
      caratula: row.title,
      actor: metadata.actor ?? metadata.actorPublico,
      demandado: metadata.demandado ?? metadata.demandadoPublico,
      objeto: metadata.objeto,
      magistrados: metadata.magistrados,
      numeroSentencia: row.caseNumber,
      numeroSumario: metadata.numeroSumario,
    },
    publicFields: {
      tema: metadata.tema,
      sala: row.chamber,
      tipoFallo: row.documentType,
      tribunalOrigen: row.court,
      expediente: row.caseNumber,
      caratula: row.title,
      actor: metadata.actorPublico ?? metadata.actor,
      demandado: metadata.demandadoPublico ?? metadata.demandado,
      objeto: metadata.objeto,
      magistrados: metadata.magistrados,
      numeroSentencia: row.caseNumber,
      numeroSumario: metadata.numeroSumario,
    },
    filterFields: {
      caseNumber: row.caseNumber,
      title: row.title,
      court: row.court,
      documentType: row.documentType,
      instance: row.instance,
    },
    mimeType: row.mimeType,
    digestoCollectionIds: row.digestoCollectionIds,
    digestoTopicIds: row.digestoTopicIds,
    digestoTagIds: row.digestoTagIds,
    aclPrincipalIds: row.aclPrincipalIds,
    sourceIds: row.sourceIds,
    sourcePaths: row.sourcePaths,
    sourceWorkspaceIds: row.sourceWorkspaceIds,
    sourceFileScopes: row.sourceFileScopes ?? [],
    linkedResultIds: row.linkedResultIds,
    ownerUserId: row.ownerUserId === null ? null : String(row.ownerUserId),
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    visibilityScope: row.visibilityScope,
    publicationStatus: 'NOT_APPLICABLE',
  }, schemaVersion);
}

export function projectJurisprudenciaSearchDocument(
  row: JurisprudenciaSearchProjection,
  schemaVersion: SearchIndexSchemaVersion = SEARCH_INDEX_SCHEMA_VERSION,
): SearchIndexDocument | null {
  if (!row.sumarioActivo || !row.sentenciaActivo) return null;
  const publicActor =
    row.anonimizado && row.actorPublico ? row.actorPublico : row.actor;
  const publicDefendant =
    row.anonimizado && row.demandadoPublico
      ? row.demandadoPublico
      : row.demandado;
  const publicTitle = row.anonimizado
    ? [publicActor, publicDefendant].filter(Boolean).join(' c/') || row.caratula
    : row.caratula;
  const canonicalSearchText = [
    row.textoBusquedaNormalizado,
    row.sentenciaSearchText,
  ]
    .filter(Boolean)
    .join(' ');
  const publicSearchText = row.anonimizado
    ? [
        row.textoBusquedaNormalizado,
        row.numeroSentencia,
        row.expediente,
        publicTitle,
        publicActor,
        publicDefendant,
        row.objeto,
        row.magistrados,
        row.sala,
        row.tipoFallo,
        row.tribunalOrigen,
      ]
        .filter(Boolean)
        .join(' ')
    : canonicalSearchText;
  const publicSentenceText = row.anonimizado
    ? [
        row.numeroSentencia,
        row.expediente,
        publicTitle,
        publicActor,
        publicDefendant,
        row.objeto,
        row.magistrados,
        row.sala,
        row.tipoFallo,
        row.tribunalOrigen,
        row.resumenPublicado ? row.resumenIa : null,
        row.resenaPublicada ? row.resena : null,
      ]
        .filter(Boolean)
        .join(' ')
    : [
        row.sentenciaSearchText,
        row.numeroSentencia,
        row.expediente,
        publicTitle,
        publicActor,
        publicDefendant,
        row.objeto,
        row.magistrados,
        row.sala,
        row.tipoFallo,
        row.tribunalOrigen,
        row.resumenPublicado ? row.resumenIa : null,
        row.resenaPublicada ? row.resena : null,
      ]
        .filter(Boolean)
        .join(' ');
  const internalSumarioText = [
    row.textoBusquedaNormalizado,
    row.texto,
    row.tema,
    row.numeroSumario,
  ]
    .filter(Boolean)
    .join(' ');
  const publicSumarioText =
    row.sumarioPublicado && row.sentenciaPublicado ? internalSumarioText : '';
  // Preserve the pre-existing projection layout while parameterizing its schema.
  // prettier-ignore
  return finishProjection({
    id: `JURISPRUDENCIA:SUMARIO:${row.id}`,
    logicalNumericId: row.id,
    sourceSystem: 'JURISPRUDENCIA',
    sourceType: 'SUMARIO',
    documentType: 'SUMARIO',
    title:
      row.tema?.trim() ||
      (row.numeroSumario ? `Sumario ${row.numeroSumario}` : null),
    subtitle: row.numeroSumario ? `Sumario ${row.numeroSumario}` : null,
    jurisdiction: 'CIVIL',
    court: row.tribunalOrigen,
    chamber: row.sala,
    instance: null,
    caseNumber: row.expediente,
    docket: null,
    decisionDate: row.fecha?.toISOString() ?? null,
    visibility:
      row.sumarioPublicado && row.sentenciaPublicado ? 'PUBLIC' : 'INTERNAL',
    documentScope: 'JURISPRUDENCE',
    status: 'ACTIVE',
    active: true,
    updatedAt: row.updatedAt.toISOString(),
    canonicalSearchText,
    publicSearchText,
    sortFields: {
      sala: row.sala,
      numeroSentencia: row.numeroSentencia,
    },
    searchScopeFields: {
      sentencia: row.sentenciaSearchText ?? '',
      sumario: internalSumarioText,
      resumen: row.resumenIa ?? '',
      resena: row.resena ?? '',
      referencias: row.referenciasSearchText ?? '',
    },
    publicSearchScopeFields: {
      sentencia: publicSentenceText,
      sumario: publicSumarioText,
      resumen:
        row.sumarioPublicado && row.sentenciaPublicado && row.resumenPublicado
          ? (row.resumenIa ?? '')
          : '',
      resena:
        row.sumarioPublicado && row.sentenciaPublicado && row.resenaPublicada
          ? (row.resena ?? '')
          : '',
      referencias: row.referenciasSearchText ?? '',
    },
    hasPdf: sentenciaTienePdfReal(row.archivosPdf ?? []).disponible,
    hasSummary: row.resumenIa !== null && row.resumenIa !== undefined,
    featured: row.destacada ?? false,
    fields: {
      tema: row.tema,
      sala: row.sala,
      tipoFallo: row.tipoFallo,
      tribunalOrigen: row.tribunalOrigen,
      expediente: row.expediente,
      caratula: row.caratula,
      actor: row.actor,
      demandado: row.demandado,
      objeto: row.objeto,
      magistrados: row.magistrados,
      numeroSentencia: row.numeroSentencia,
      numeroSumario: row.numeroSumario,
    },
    publicFields: {
      tema: row.tema,
      sala: row.sala,
      tipoFallo: row.tipoFallo,
      tribunalOrigen: row.tribunalOrigen,
      expediente: row.expediente,
      caratula: publicTitle,
      actor: publicActor,
      demandado: publicDefendant,
      objeto: row.objeto,
      magistrados: row.magistrados,
      numeroSentencia: row.numeroSentencia,
      numeroSumario: row.numeroSumario,
    },
    filterFields: {
      caseNumber: row.expediente,
      title: row.caratula,
      court: row.tribunalOrigen,
      documentType: row.tipoFallo,
      instance: null,
    },
    publicFilterFields: {
      caseNumber: row.expediente,
      title: publicTitle,
      court: row.tribunalOrigen,
      documentType: row.tipoFallo,
      instance: null,
    },
    mimeType: null,
    digestoCollectionIds: [],
    digestoTopicIds: [],
    digestoTagIds: [],
    aclPrincipalIds: [],
    sourceIds: [],
    sourcePaths: [],
    sourceWorkspaceIds: [],
    linkedResultIds: [],
    ownerUserId: null,
    workspaceId: null,
    folderId: null,
    visibilityScope: null,
    publicationStatus:
      row.sumarioPublicado && row.sentenciaPublicado
        ? 'PUBLISHED'
        : 'UNPUBLISHED',
  }, schemaVersion);
}

export function projectSentenciaSearchDocument(
  row: SentenciaSearchProjection,
  schemaVersion: SearchIndexSchemaVersion = SEARCH_INDEX_SCHEMA_VERSION,
): SearchIndexDocument | null {
  if (!row.activo) return null;
  const published = row.publicado && row.estadoCarga === 'PUBLICADA';
  const publicActor =
    row.anonimizado && row.actorPublico ? row.actorPublico : row.actor;
  const publicDefendant =
    row.anonimizado && row.demandadoPublico
      ? row.demandadoPublico
      : row.demandado;
  const publicTitle = row.anonimizado
    ? [publicActor, publicDefendant].filter(Boolean).join(' c/') || row.caratula
    : row.caratula;
  const publicSearchText = row.anonimizado
    ? [
        row.numeroSentencia,
        row.expediente,
        publicTitle,
        publicActor,
        publicDefendant,
        row.objeto,
        row.magistrados,
        row.sala,
        row.tipoFallo,
        row.tribunalOrigen,
        row.sumariosSearchText,
        row.resumenPublicado ? row.resumenIa : null,
        row.resenaPublicada ? row.resena : null,
      ]
        .filter(Boolean)
        .join(' ')
    : [row.textoBusquedaNormalizado, row.sumariosSearchText]
        .filter(Boolean)
        .join(' ');
  // Preserve the pre-existing projection layout while parameterizing its schema.
  // prettier-ignore
  return finishProjection({
    id: `JURISPRUDENCIA:SENTENCIA:${row.id}`,
    logicalNumericId: row.id,
    sourceSystem: 'JURISPRUDENCIA',
    sourceType: 'SENTENCIA',
    documentType: 'JURISPRUDENCIA_SENTENCIA',
    title: row.caratula?.trim() || row.numeroSentencia || `Sentencia ${row.id}`,
    subtitle: row.numeroSentencia,
    jurisdiction: 'CIVIL',
    court: row.tribunalOrigen,
    chamber: row.sala,
    instance: null,
    caseNumber: row.expediente,
    docket: null,
    decisionDate: row.fecha?.toISOString() ?? null,
    visibility: published ? 'PUBLIC' : 'INTERNAL',
    documentScope: 'JURISPRUDENCE',
    status: row.estadoCarga,
    active: row.activo,
    updatedAt: row.updatedAt.toISOString(),
    sortFields: {
      sala: row.sala,
      numeroSentencia: row.numeroSentencia,
    },
    // Summary text is attached only through the real Sumario.sentenciaId FK.
    // The repository excludes unpublished summaries for a published Sentence.
    canonicalSearchText: [row.textoBusquedaNormalizado, row.sumariosSearchText]
      .filter(Boolean)
      .join(' '),
    publicSearchText,
    searchScopeFields: {
      sentencia: row.textoBusquedaNormalizado ?? '',
      sumario: row.sumariosSearchText ?? '',
      resumen: row.resumenIa ?? '',
      resena: row.resena ?? '',
      referencias: row.referenciasSearchText ?? '',
    },
    publicSearchScopeFields: {
      sentencia: row.anonimizado
        ? [
            row.numeroSentencia,
            row.expediente,
            publicTitle,
            publicActor,
            publicDefendant,
            row.objeto,
            row.magistrados,
            row.sala,
            row.tipoFallo,
            row.tribunalOrigen,
          ]
            .filter(Boolean)
            .join(' ')
        : (row.textoBusquedaNormalizado ?? ''),
      sumario: row.sumariosSearchText ?? '',
      resumen: published && row.resumenPublicado ? (row.resumenIa ?? '') : '',
      resena: published && row.resenaPublicada ? (row.resena ?? '') : '',
      referencias: row.referenciasSearchText ?? '',
    },
    hasPdf: sentenciaTienePdfReal(row.archivosPdf ?? []).disponible,
    hasSummary: row.resumenIa !== null && row.resumenIa !== undefined,
    featured: row.destacada ?? false,
    fields: {
      tema: row.sumariosSearchText,
      sala: row.sala,
      tipoFallo: row.tipoFallo,
      tribunalOrigen: row.tribunalOrigen,
      expediente: row.expediente,
      caratula: row.caratula,
      actor: row.actor,
      demandado: row.demandado,
      objeto: row.objeto,
      magistrados: row.magistrados,
      numeroSentencia: row.numeroSentencia,
      numeroSumario: row.numeroSumarios,
    },
    publicFields: {
      tema: row.sumariosSearchText,
      sala: row.sala,
      tipoFallo: row.tipoFallo,
      tribunalOrigen: row.tribunalOrigen,
      expediente: row.expediente,
      caratula: publicTitle,
      actor: publicActor,
      demandado: publicDefendant,
      objeto: row.objeto,
      magistrados: row.magistrados,
      numeroSentencia: row.numeroSentencia,
      numeroSumario: row.numeroSumarios,
    },
    filterFields: {
      caseNumber: row.expediente,
      title: row.caratula,
      court: row.tribunalOrigen,
      documentType: row.tipoFallo,
      instance: null,
    },
    publicFilterFields: {
      caseNumber: row.expediente,
      title: publicTitle,
      court: row.tribunalOrigen,
      documentType: row.tipoFallo,
      instance: null,
    },
    mimeType: null,
    digestoCollectionIds: [],
    digestoTopicIds: [],
    digestoTagIds: [],
    aclPrincipalIds: [],
    sourceIds: [],
    sourcePaths: [],
    sourceWorkspaceIds: [],
    linkedResultIds: [],
    ownerUserId: null,
    workspaceId: null,
    folderId: null,
    visibilityScope: null,
    publicationStatus: published ? 'PUBLISHED' : 'UNPUBLISHED',
  }, schemaVersion);
}

function finishProjection(
  input: Omit<
    SearchIndexDocument,
    | 'lexicalTokens'
    | 'publicLexicalTokens'
    | 'phraseSequence'
    | 'publicPhraseSequence'
    | 'phraseBigrams'
    | 'publicPhraseBigrams'
    | 'searchScopeFields'
    | 'publicSearchScopeFields'
    | 'publicSearchText'
    | 'indexSchemaVersion'
    | 'fields'
    | 'publicFields'
    | 'filterFields'
    | 'publicFilterFields'
  > & {
    publicSearchText?: string;
    searchScopeFields?: Partial<
      Record<(typeof SEARCH_SCOPE_NAMES)[number], unknown>
    >;
    publicSearchScopeFields?: Partial<
      Record<(typeof SEARCH_SCOPE_NAMES)[number], unknown>
    >;
    fields: Record<string, unknown>;
    publicFields?: Record<string, unknown>;
    filterFields: Record<string, unknown>;
    publicFilterFields?: Record<string, unknown>;
  },
  schemaVersion: SearchIndexSchemaVersion = SEARCH_INDEX_SCHEMA_VERSION,
): SearchIndexDocument {
  const canonical = normalizeSearchText(input.canonicalSearchText);
  const publicSearch = normalizeSearchText(input.publicSearchText ?? canonical);
  const searchScopeFields = projectScopeFields(input.searchScopeFields);
  const publicSearchScopeFields = projectScopeFields(
    input.publicSearchScopeFields ?? input.searchScopeFields,
  );
  const fields: Record<string, string | string[] | null> = {};
  const publicFields: Record<string, string | string[] | null> = {};
  for (const name of SEARCH_FIELD_NAMES) {
    const value = normalizeOptionalText(input.fields[name]);
    fields[name] = value;
    fields[`${name}Tokens`] = value === null ? [] : lexicalTokens(value);
    fields[`${name}Phrase`] = value === null ? '' : phraseSequence(value);
    fields[`${name}PhraseBigrams`] =
      value === null ? '' : phraseBigramSequence(value);
    const publicValue = normalizeOptionalText(
      input.publicFields?.[name] ?? input.fields[name],
    );
    publicFields[name] = publicValue;
    publicFields[`${name}Tokens`] =
      publicValue === null ? [] : lexicalTokens(publicValue);
    publicFields[`${name}Phrase`] =
      publicValue === null ? '' : phraseSequence(publicValue);
    publicFields[`${name}PhraseBigrams`] =
      publicValue === null ? '' : phraseBigramSequence(publicValue);
  }
  const filterFields: Record<string, string | null> = {};
  for (const [name, raw] of Object.entries(input.filterFields)) {
    filterFields[name] = normalizeOptionalText(raw);
  }
  const publicFilterFields: Record<string, string | null> = {};
  const publicFilterInput = input.publicFilterFields ?? input.filterFields;
  for (const [name, raw] of Object.entries(publicFilterInput)) {
    publicFilterFields[name] = normalizeOptionalText(raw);
  }
  const sortFields =
    schemaVersion === SEARCH_INDEX_SCHEMA_VERSION_V4
      ? {
          ...(input.sortFields ?? { sala: null, numeroSentencia: null }),
          numeroSentenciaCollation: input.sortFields?.numeroSentencia ?? '',
        }
      : input.sortFields;
  return {
    ...input,
    ...(sortFields ? { sortFields } : {}),
    canonicalSearchText: canonical,
    publicSearchText: publicSearch,
    lexicalTokens: lexicalTokens(canonical),
    publicLexicalTokens: lexicalTokens(publicSearch),
    phraseSequence: phraseSequence(canonical),
    publicPhraseSequence: phraseSequence(publicSearch),
    phraseBigrams: phraseBigramSequence(canonical),
    publicPhraseBigrams: phraseBigramSequence(publicSearch),
    searchScopeFields,
    publicSearchScopeFields,
    fields,
    publicFields,
    filterFields,
    publicFilterFields,
    indexSchemaVersion: schemaVersion,
  };
}

function projectScopeFields(
  values?: Partial<Record<(typeof SEARCH_SCOPE_NAMES)[number], unknown>>,
): Record<(typeof SEARCH_SCOPE_NAMES)[number], SearchScopeField> {
  return Object.fromEntries(
    SEARCH_SCOPE_NAMES.map((name) => {
      const text = normalizeOptionalText(values?.[name]) ?? '';
      return [
        name,
        {
          text,
          tokens: lexicalTokens(text),
          phraseSequence: phraseSequence(text),
          phraseBigrams: phraseBigramSequence(text),
        },
      ];
    }),
  ) as Record<(typeof SEARCH_SCOPE_NAMES)[number], SearchScopeField>;
}

function normalizeOptionalText(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const text = values
    .filter(
      (item): item is string | number | boolean =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
    .map(String)
    .filter((item) => item.trim().length > 0)
    .join(' ');
  return text ? normalizeSearchText(text) : null;
}

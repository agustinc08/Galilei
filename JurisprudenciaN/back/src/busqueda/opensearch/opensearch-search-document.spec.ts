import {
  projectSentenciaSearchDocument,
  type SentenciaSearchProjection,
} from './opensearch-search-document';

function sentencia(
  input: Partial<SentenciaSearchProjection> = {},
): SentenciaSearchProjection {
  return {
    id: 8142,
    numeroSentencia: 'A-123',
    tipoFallo: 'SENTENCIA DEFINITIVA',
    sala: 'Sala I',
    fecha: new Date('2024-02-03T00:00:00.000Z'),
    expediente: '123/2024',
    tribunalOrigen: 'Cámara Civil',
    actor: 'Actor',
    actorPublico: 'A.',
    demandado: 'Demandado',
    demandadoPublico: 'D.',
    anonimizado: false,
    objeto: 'Daños',
    magistrados: 'Jueza',
    caratula: 'Actor c/ Demandado',
    textoBusquedaNormalizado: 'sentencia texto',
    sumariosSearchText: 'sumario vinculado',
    numeroSumarios: ['S-1'],
    publicado: true,
    activo: true,
    estadoCarga: 'PUBLICADA',
    updatedAt: new Date('2024-02-04T00:00:00.000Z'),
    ...input,
  };
}

describe('Sentencia logical Search projection', () => {
  it('uses stable Sentencia identity and carries only the supplied FK-backed text', () => {
    const document = projectSentenciaSearchDocument(sentencia());
    expect(document).toMatchObject({
      id: 'JURISPRUDENCIA:SENTENCIA:8142',
      sourceSystem: 'JURISPRUDENCIA',
      sourceType: 'SENTENCIA',
      documentType: 'JURISPRUDENCIA_SENTENCIA',
      visibility: 'PUBLIC',
      publicationStatus: 'PUBLISHED',
    });
    expect(document?.canonicalSearchText).toBe(
      'sentencia texto sumario vinculado',
    );
  });

  it('does not classify review records as public even when the boolean flag is set', () => {
    const document = projectSentenciaSearchDocument(
      sentencia({ estadoCarga: 'EN_REVISION' }),
    );
    expect(document).toMatchObject({
      visibility: 'INTERNAL',
      publicationStatus: 'UNPUBLISHED',
    });
  });

  it('omits inactive Sentencias from the eligible universe', () => {
    expect(
      projectSentenciaSearchDocument(sentencia({ activo: false })),
    ).toBeNull();
  });

  it('keeps anonymized public search text and fields free of private participant names', () => {
    const document = projectSentenciaSearchDocument(
      sentencia({
        actor: 'Ana García',
        actorPublico: 'A. G.',
        demandado: 'Bruno Pérez',
        demandadoPublico: 'B. P.',
        caratula: 'Ana García c/ Bruno Pérez',
        anonimizado: true,
        textoBusquedaNormalizado:
          'acta con nombres privados ana garcia bruno perez',
      }),
    );

    expect(document?.canonicalSearchText).toContain('ana garcia');
    expect(document?.publicSearchText).not.toContain('ana garcia');
    expect(document?.publicSearchText).not.toContain('bruno perez');
    expect(document?.publicFields.actor).not.toContain('ana');
    expect(document?.publicFilterFields.title).not.toContain('ana garcia');
  });
});

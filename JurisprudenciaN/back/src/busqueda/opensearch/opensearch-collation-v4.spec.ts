import {
  SEARCH_INDEX_DEFINITION,
  SEARCH_INDEX_DEFINITION_V4,
  SEARCH_INDEX_SCHEMA_VERSION_V4,
  SEARCH_V4_COLLATION_PIPELINE,
  SEARCH_V4_COLLATION_PIPELINE_ID,
} from './opensearch-mapping';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('EXPECTED_OBJECT');
  return value as Record<string, unknown>;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('certified OpenSearch collation schema v4', () => {
  it('adds only the two ICU collation fields, version metadata, and final pipeline to v3', () => {
    const base = cloneRecord(SEARCH_INDEX_DEFINITION);
    const candidate = cloneRecord(SEARCH_INDEX_DEFINITION_V4);

    const settings = asRecord(candidate.settings);
    const mappings = asRecord(candidate.mappings);
    const metadata = asRecord(mappings._meta);
    const properties = asRecord(mappings.properties);
    const id = asRecord(properties.id);
    const sortFields = asRecord(properties.sortFields);
    const sortFieldProperties = asRecord(sortFields.properties);

    delete settings.final_pipeline;
    metadata.galileiSearchSchemaVersion = 3;
    delete id.fields;
    delete sortFieldProperties.numeroSentenciaCollation;

    expect(candidate).toEqual(base);
    expect(
      asRecord(asRecord(SEARCH_INDEX_DEFINITION_V4).mappings)._meta,
    ).toMatchObject({
      galileiSearchSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION_V4,
      openSearchCompatibility: '2.19.6',
    });
    expect(
      asRecord(asRecord(SEARCH_INDEX_DEFINITION_V4).settings).final_pipeline,
    ).toBe(SEARCH_V4_COLLATION_PIPELINE_ID);
  });

  it('matches the lab-accepted ICU mapping for sentencia number and ID tiebreak', () => {
    const mappings = asRecord(asRecord(SEARCH_INDEX_DEFINITION_V4).mappings);
    const properties = asRecord(mappings.properties);
    const sortFields = asRecord(properties.sortFields);
    const sortProperties = asRecord(sortFields.properties);
    const id = asRecord(properties.id);
    const idFields = asRecord(id.fields);
    const expected = {
      type: 'icu_collation_keyword',
      language: 'es',
      country: 'AR',
      variant: '@collation=standard',
      strength: 'tertiary',
      decomposition: 'no',
      alternate: 'non-ignorable',
      case_level: false,
      numeric: false,
      index: false,
      doc_values: true,
    };

    expect(sortProperties.numeroSentenciaCollation).toEqual(expected);
    expect(idFields.collation).toEqual(expected);
    expect(sortProperties.sala).toEqual({
      type: 'keyword',
      ignore_above: 8191,
    });
  });

  it('defines a null/missing-to-empty derivation without trimming or rewriting raw values', () => {
    const pipeline = asRecord(SEARCH_V4_COLLATION_PIPELINE);
    const processors = pipeline.processors as unknown[];
    const processor = asRecord(processors[0]);
    const script = asRecord(processor.script);
    const source = script.source as string;
    expect(source).toContain("value == null ? '' : value");
    expect(source).not.toMatch(/trim|normalize|toLowerCase|numeric/iu);

    const derive = (value: string | null | undefined) => value ?? '';
    expect(derive(undefined)).toBe('');
    expect(derive(null)).toBe('');
    expect(derive('')).toBe('');
    expect(derive('  077510  ')).toBe('  077510  ');
  });
});

/** Small, manually inspectable synthetic evaluation set; not corpus labels. */
export const CITATION_EVALUATION_SET = [
  {
    id: 'explicit-expediente',
    kind: 'positive',
    text: 'Conforme a lo resuelto en el Expte. N° 1234/2020.',
    gold: ['EXPEDIENTE:1234/2020'],
  },
  {
    id: 'explicit-sentence-number',
    kind: 'positive',
    text: 'La sentencia N° 88/2022 fue citada como antecedente.',
    gold: ['NUMERO_SENTENCIA:88/2022'],
  },
  {
    id: 'multiple-identifiers',
    kind: 'positive',
    text: 'Expediente 45/2019 y fallo N° 7/2021.',
    gold: ['EXPEDIENTE:45/2019', 'NUMERO_SENTENCIA:7/2021'],
  },
  {
    id: 'duplicate-identifier',
    kind: 'positive',
    text: 'Expte. 1234/2020; ver también Expte. 1234/2020.',
    gold: ['EXPEDIENTE:1234/2020'],
  },
  {
    id: 'date-only-negative',
    kind: 'negative',
    text: 'El acuerdo se firmó el 14/03/2020.',
    gold: [],
  },
  {
    id: 'statute-number-negative',
    kind: 'negative',
    text: 'Se aplicó la ley 1234/2020.',
    gold: [],
  },
  {
    id: 'ambiguous-case-reference',
    kind: 'ambiguous',
    text: 'Como se sostuvo en la causa 1234/2020.',
    gold: [],
  },
  {
    id: 'incomplete-reference',
    kind: 'incomplete',
    text: 'Expte. N° 1234, sin año visible.',
    gold: [],
  },
] as const;

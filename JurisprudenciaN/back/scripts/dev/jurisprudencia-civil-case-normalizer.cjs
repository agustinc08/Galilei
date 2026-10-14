'use strict';

const VERSION = 'civil-case-normalizer-v2';
const STATUSES = Object.freeze(['VALID_CANONICAL', 'VALID_LEGACY', 'VALID_MULTI_CASE', 'PARTIAL', 'AMBIGUOUS', 'MALFORMED', 'UNSUPPORTED']);

function clean(value) {
  return String(value ?? '').normalize('NFC')
    .replace(/[\u00a0\u2007\u2009\u202f]/gu, ' ')
    .replace(/[\t\f\v ]+/gu, ' ').trim();
}

function splitMultiCase(raw) {
  const parts = raw.split(/\s*(?:;|,|\r?\n|\by\b)\s*/iu).map(clean).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function parseOne(raw, rawYear) {
  const original = clean(raw);
  if (!original) return { status: rawYear ? 'PARTIAL' : 'MALFORMED', format: rawYear ? 'YEAR_WITHOUT_CASE' : 'EMPTY', cases: [], warnings: ['CASE_NUMBER_MISSING'] };
  if (original.length > 8192) return { status: 'UNSUPPORTED', format: 'INPUT_TOO_LONG', cases: [], warnings: ['INPUT_LENGTH_LIMIT_EXCEEDED'], rawPreserved: original };

  let value = original;
  let wrapper = false;
  for (let index = 0; index < 3; index++) {
    const wrapperMatch = value.match(/^(?:(?:EXPEDIENTE|EXPTE?\.?|CAUSA)\s*[:#]?\s*|N(?:RO|UM(?:ERO)?)?\s*[°º.]\s*|CIV(?:IL)?\s+)/iu);
    if (!wrapperMatch) break;
    wrapper = true;
    value = clean(value.slice(wrapperMatch[0].length));
  }
  if (/^[\p{L}]/u.test(value) && !/^CIV(?:IL)?\b/iu.test(value)) {
    return { status: 'UNSUPPORTED', format: 'UNRECOGNIZED_PREFIX', cases: [], warnings: ['UNRECOGNIZED_PREFIX'], rawPreserved: original };
  }
  // A jurisdiction prefix may follow an expediente wrapper.
  if (/^CIV(?:IL)?\s+/iu.test(value)) { wrapper = true; value = clean(value.replace(/^CIV(?:IL)?\s+/iu, '')); }

  const hadTerminalPeriod = /\.$/u.test(value);
  if (hadTerminalPeriod) value = value.slice(0, -1).trimEnd();
  let suffixYear = null;
  let separator = null;
  let groupedYearSuffix = false;
  const suffix = value.match(/^(.*?)(\s*[/\-]\s*)(\d{2}|\d{4}|\d\.\d{3})$/u);
  if (suffix) {
    value = clean(suffix[1]); separator = suffix[2].includes('/') ? 'SLASH' : 'DASH';
    groupedYearSuffix = /^\d\.\d{3}$/u.test(suffix[3]);
    suffixYear = suffix[3].replace(/\./gu, '');
  }

  const separateYear = clean(rawYear);
  if (separateYear && !/^(?:\d{2}|\d{4})$/u.test(separateYear)) {
    return { status: 'MALFORMED', format: 'INVALID_SEPARATE_YEAR', cases: [], warnings: ['YEAR_MUST_HAVE_TWO_OR_FOUR_DIGITS'], rawPreserved: original };
  }
  if (groupedYearSuffix && (!separateYear || suffixYear !== separateYear)) {
    return { status: 'AMBIGUOUS', format: 'GROUPED_FOUR_DIGIT_YEAR_WITHOUT_CORROBORATION', cases: [], warnings: ['GROUPED_YEAR_REQUIRES_MATCHING_CASE_YEAR_FIELD'], rawPreserved: original };
  }
  if (suffixYear && separateYear && suffixYear !== separateYear) {
    return { status: 'AMBIGUOUS', format: 'CONFLICTING_CASE_AND_YEAR_FIELDS', cases: [], warnings: ['CASE_SUFFIX_YEAR_DIFFERS_FROM_CASE_YEAR'], rawPreserved: original };
  }
  const year = suffixYear || separateYear || null;
  if (year && year.length === 4 && (Number(year) < 1700 || Number(year) > 2099)) {
    return { status: 'AMBIGUOUS', format: 'FOUR_DIGIT_YEAR_OUTSIDE_SUPPORTED_RANGE', cases: [], warnings: ['FOUR_DIGIT_YEAR_OUTSIDE_1700_2099'], rawPreserved: original };
  }

  const groupedDigits = /^\d{1,3}(?:[. ]\d{3})+$/u.test(value);
  const plainDigits = /^\d{1,9}$/u.test(value);
  if (!groupedDigits && !plainDigits) {
    const hasDigits = /\d/u.test(value);
    return { status: hasDigits ? 'MALFORMED' : 'UNSUPPORTED', format: 'UNRECOGNIZED_CASE_SHAPE', cases: [], warnings: ['CASE_SHAPE_NOT_RECOGNIZED'], rawPreserved: original };
  }

  const number = value.replace(/[. ]/gu, '');
  if (!year && !groupedDigits) {
    return { status: 'PARTIAL', format: 'NUMBER_WITHOUT_YEAR', cases: [], warnings: ['CASE_YEAR_MISSING_AND_FORMAT_NOT_IN_OBSERVED_LEGACY_CATALOG'], rawPreserved: original };
  }
  const legacy = wrapper || groupedDigits || separator === 'DASH' || (year?.length === 2) || groupedYearSuffix || hadTerminalPeriod;
  const format = !year ? (groupedDigits ? 'GROUPED_NUMBER_WITHOUT_YEAR' : 'NUMBER_WITHOUT_YEAR')
    : `${groupedDigits ? 'GROUPED_NUMBER' : 'PLAIN_NUMBER'}_${separator || 'SEPARATE_YEAR'}_${groupedYearSuffix ? 'GROUPED_4' : year.length}_DIGIT_YEAR${wrapper ? '_WRAPPED' : ''}${hadTerminalPeriod ? '_TRAILING_PERIOD' : ''}`;
  const item = { canonicalCaseNumber: number, canonicalYear: year, normalizedDisplay: year ? `${number}/${year}` : number, detectedFormat: format };
  return { status: legacy ? 'VALID_LEGACY' : 'VALID_CANONICAL', format, cases: [item], warnings: [], rawPreserved: original };
}

function normalizeCivilCaseReference(input = {}) {
  if (typeof input === 'string') input = { rawCase: input };
  const rawCase = input.rawCase ?? input.caseNumber ?? '';
  const rawYear = input.rawYear ?? input.caseYear ?? '';
  const raw = String(rawCase ?? '').normalize('NFC').replace(/[\u00a0\u2007\u2009\u202f]/gu, ' ').trim();
  const multiParts = splitMultiCase(raw);
  if (multiParts) {
    if (clean(rawYear)) return { ruleVersion: VERSION, status: 'AMBIGUOUS', canonicalCaseNumber: null, canonicalYear: null,
      normalizedDisplay: null, detectedFormat: 'MULTI_CASE_WITH_SEPARATE_YEAR', cases: [], warnings: ['SEPARATE_YEAR_ALIGNMENT_ACROSS_CASE_LIST_UNCLEAR'],
      evidence: { rawPreserved: String(rawCase ?? ''), source: input.source || null, caseYear: rawYear } };
    const parsed = multiParts.map(part => parseOne(part, null));
    if (parsed.every(item => item.cases.length === 1 && ['VALID_CANONICAL', 'VALID_LEGACY'].includes(item.status))) {
      const cases = parsed.map(item => item.cases[0]);
      return { ruleVersion: VERSION, status: 'VALID_MULTI_CASE', canonicalCaseNumber: null, canonicalYear: null,
        normalizedDisplay: cases.map(item => item.normalizedDisplay).join('; '), detectedFormat: 'MULTI_CASE_LIST', cases,
        warnings: ['MULTIPLE_CASES_PRESERVED'], evidence: { rawPreserved: String(rawCase ?? ''), source: input.source || null, caseYear: rawYear || null } };
    }
    return { ruleVersion: VERSION, status: 'AMBIGUOUS', canonicalCaseNumber: null, canonicalYear: null,
      normalizedDisplay: null, detectedFormat: 'MULTI_CASE_LIST_UNRESOLVED', cases: [], warnings: ['MULTI_CASE_COMPONENT_NOT_UNAMBIGUOUS'],
      evidence: { rawPreserved: String(rawCase ?? ''), source: input.source || null, caseYear: rawYear || null } };
  }
  const result = parseOne(rawCase, rawYear);
  const item = result.cases[0] || null;
  return { ruleVersion: VERSION, status: result.status, canonicalCaseNumber: item?.canonicalCaseNumber || null,
    canonicalYear: item?.canonicalYear || null, normalizedDisplay: item?.normalizedDisplay || null,
    detectedFormat: result.format, cases: result.cases, warnings: result.warnings,
    evidence: { rawPreserved: String(rawCase ?? ''), source: input.source || null, caseYear: rawYear || null } };
}

module.exports = { VERSION, STATUSES, normalizeCivilCaseReference };

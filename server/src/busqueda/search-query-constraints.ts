/**
 * No business limit existed for q. 512 UTF-16 code units accommodates roughly
 * 70–90 ordinary Spanish words for complex legal queries, while bounding
 * untrusted query parsing; the count matches the browser's maxlength rule.
 */
export const SEARCH_QUERY_MAX_LENGTH = 512;

export const SEARCH_QUERY_TOO_LONG_MESSAGE =
  'La búsqueda es demasiado larga. Reducí el texto e intentá nuevamente.';

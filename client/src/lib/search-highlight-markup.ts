export type SearchHighlightToken = {
  kind: 'text' | 'mark';
  text: string;
};

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeHighlightEntities(value: string) {
  return value.replace(/&(amp|lt|gt|quot|#39);/gu, (entity) =>
    ENTITY_MAP[entity] ?? entity,
  );
}

/** Parses only the server's escaped <mark> output. All other markup stays text. */
export function parseSearchHighlightMarkup(markup: string): SearchHighlightToken[] {
  const tokens: SearchHighlightToken[] = [];
  const markPattern = /<mark>([\s\S]*?)<\/mark>/gu;
  let cursor = 0;

  for (const match of markup.matchAll(markPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({
        kind: 'text',
        text: decodeHighlightEntities(markup.slice(cursor, start)),
      });
    }
    tokens.push({
      kind: 'mark',
      text: decodeHighlightEntities(match[1] ?? ''),
    });
    cursor = start + match[0].length;
  }

  if (cursor < markup.length || tokens.length === 0) {
    tokens.push({
      kind: 'text',
      text: decodeHighlightEntities(markup.slice(cursor)),
    });
  }
  return tokens;
}

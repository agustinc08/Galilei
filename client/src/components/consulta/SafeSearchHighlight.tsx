'use client';

import { parseSearchHighlightMarkup } from '@/lib/search-highlight-markup';

type Props = {
  markup: string;
  className?: string;
};

export function SafeSearchHighlight({ markup, className }: Props) {
  return (
    <>
      {parseSearchHighlightMarkup(markup).map((token, index) =>
        token.kind === 'mark' ? (
          <mark key={`match-${index}`} className={className}>
            {token.text}
          </mark>
        ) : (
          <span key={`text-${index}`}>{token.text}</span>
        ),
      )}
    </>
  );
}

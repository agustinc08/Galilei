import styles from './search-autocomplete.module.css';
import type { SearchSuggestion } from '@/types/busqueda';
import { searchSuggestionMeta } from '@/lib/search-suggestion-presentation';

type Props = {
  suggestions: SearchSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: SearchSuggestion) => void;
};

export function SuggestionDropdown({
  suggestions,
  activeIndex,
  onSelect,
}: Props) {
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className={styles.dropdown}>
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.tipo}-${suggestion.value}`}
          type="button"
          className={`${styles.item} ${activeIndex === index ? styles.itemActive : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(suggestion);
          }}
        >
          <span>{suggestion.value}</span>
          <span className={styles.meta}>
            {searchSuggestionMeta(suggestion)}
          </span>
        </button>
      ))}
    </div>
  );
}

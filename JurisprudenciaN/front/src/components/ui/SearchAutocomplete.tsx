'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './search-autocomplete.module.css';
import { api } from '@/lib/api';
import { trackEvento } from '@/lib/tracking';
import type { ListResponse } from '@/types/common';
import type { SearchSuggestion } from '@/types/busqueda';
import { SuggestionDropdown } from './SuggestionDropdown';

type Props = {
  label: string;
  value: string;
  endpoint: string;
  placeholder?: string;
  skipAuth?: boolean;
  onChange: (value: string) => void;
  onSelect?: (value: string, suggestion: SearchSuggestion) => void;
};

type CachedSuggestions = {
  data: SearchSuggestion[];
  expiresAt: number;
};

const suggestionCache = new Map<string, CachedSuggestions>();
const SUGGESTION_CACHE_TTL_MS = 30_000;

export function SearchAutocomplete({
  label,
  value,
  endpoint,
  placeholder,
  skipAuth = false,
  onChange,
  onSelect,
}: Props) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const trimmedValue = useMemo(() => value.trim(), [value]);
  const visibleSuggestions = trimmedValue.length < 3 ? [] : suggestions;

  useEffect(() => {
    if (trimmedValue.length < 3) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      const cacheKey = `${endpoint}:${skipAuth ? 'public' : 'auth'}:${trimmedValue.toLowerCase()}`;
      const cached = suggestionCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        setSuggestions(cached.data);
        setOpen(true);
        setActiveIndex(-1);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.get<ListResponse<SearchSuggestion>>(endpoint, {
          query: { q: trimmedValue },
          skipAuth,
          signal: controller.signal,
        });
        const nextSuggestions = response.data.slice(0, 20);
        suggestionCache.set(cacheKey, {
          data: nextSuggestions,
          expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
        });
        setSuggestions(nextSuggestions);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [endpoint, skipAuth, trimmedValue]);

  const applySuggestion = (suggestion: SearchSuggestion) => {
    onChange(suggestion.value);
    setOpen(false);
    void trackEvento({
      tipoEvento: 'suggestion_click',
      metadata: {
        value: suggestion.value,
        tipo: suggestion.tipo,
        origen: endpoint,
      },
    });
    onSelect?.(suggestion.value, suggestion);
  };

  return (
    <label className={styles.wrapper}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (!open || visibleSuggestions.length === 0) {
            return;
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, visibleSuggestions.length - 1));
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
          }

          if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            applySuggestion(visibleSuggestions[activeIndex]);
          }

          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {isLoading ? <span className={styles.loading}>Buscando...</span> : null}
      {open ? (
        <SuggestionDropdown
          suggestions={visibleSuggestions}
          activeIndex={activeIndex}
          onSelect={applySuggestion}
        />
      ) : null}
    </label>
  );
}

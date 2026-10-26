'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, usePathname, useSearchParams } from '@/lib/router-compat';
import { Button } from '@/components/ui/Button';
import styles from './comparison-selection.module.css';

export type ComparisonSelectionItem = {
  slug: string;
  title: string;
};

type ComparisonSelectionContextValue = {
  items: ComparisonSelectionItem[];
  message: string | null;
  toggle: (item: ComparisonSelectionItem) => void;
  replace: (items: ComparisonSelectionItem[]) => void;
  clear: () => void;
  returnTo: string;
};

const STORAGE_KEY = 'galilei.public-comparison-selection.v1';
const RETURN_KEY = 'galilei.public-comparison-return.v1';
const ComparisonSelectionContext = createContext<ComparisonSelectionContextValue | null>(null);

function readStoredSelection(): ComparisonSelectionItem[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ComparisonSelectionItem =>
        typeof item === 'object' && item !== null &&
        'slug' in item && typeof item.slug === 'string' &&
        'title' in item && typeof item.title === 'string',
      )
      .slice(0, 4);
  } catch {
    return [];
  }
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/consulta';
  if (/^\/(consulta|colecciones|favoritos)(?:\/|\?|$)/u.test(value)) return value;
  return '/consulta';
}

export function ComparisonSelectionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ComparisonSelectionItem[]>(readStoredSelection);
  const [message, setMessage] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState(() => {
    try {
      return safeReturnPath(window.sessionStorage.getItem(RETURN_KEY));
    } catch {
      return '/consulta';
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      if (items.length === 0) window.sessionStorage.removeItem(RETURN_KEY);
      else window.sessionStorage.setItem(RETURN_KEY, returnTo);
    } catch {
      // The tray remains usable for this page when storage is unavailable.
    }
  }, [items, returnTo]);

  const toggle = useCallback((item: ComparisonSelectionItem) => {
    const existing = items.some((candidate) => candidate.slug === item.slug);
    setMessage(null);
    if (existing) {
      setItems(items.filter((candidate) => candidate.slug !== item.slug));
      return;
    }
    if (items.length >= 4) {
      setMessage('La comparación admite hasta cuatro fallos. Quitá uno para agregar otro.');
      return;
    }
    if (items.length === 0 && pathname !== '/comparar') {
      const search = searchParams.toString();
      const nextReturn = `${pathname}${search ? `?${search}` : ''}`;
      setReturnTo(safeReturnPath(nextReturn));
    }
    setItems([...items, item]);
  }, [items, pathname, searchParams]);

  const replace = useCallback((nextItems: ComparisonSelectionItem[]) => {
    const unique = [...new Map(nextItems.map((item) => [item.slug, item])).values()].slice(0, 4);
    setItems(unique);
    setMessage(null);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setMessage(null);
  }, []);

  const value = useMemo(() => ({ items, message, toggle, replace, clear, returnTo }), [items, message, toggle, replace, clear, returnTo]);

  return (
    <ComparisonSelectionContext.Provider value={value}>
      {children}
      {items.length > 0 ? (
        <aside className={styles.tray} aria-label="Fallos seleccionados para comparar">
          <div className={styles.trayItems}>
            <strong>Comparar fallos</strong>
            <span className={styles.count}>{items.length} de 4</span>
            {items.map((item, index) => (
              <span className={styles.chip} key={item.slug} title={item.title}>
                <span>{String.fromCharCode(65 + index)} · {item.title}</span>
                <button type="button" aria-label={`Quitar ${item.title}`} onClick={() => toggle(item)}>×</button>
              </span>
            ))}
          </div>
          <div className={styles.trayActions}>
            {message ? <span className={styles.message} role="status">{message}</span> : null}
            <Button variant="ghost" onClick={clear}>Vaciar</Button>
            <Link href={`/comparar?ids=${items.map((item) => encodeURIComponent(item.slug)).join(',')}`}>
              <Button disabled={items.length < 2}>
                Comparar
              </Button>
            </Link>
          </div>
        </aside>
      ) : null}
    </ComparisonSelectionContext.Provider>
  );
}

export function useComparisonSelection() {
  const context = useContext(ComparisonSelectionContext);
  if (!context) throw new Error('useComparisonSelection debe usarse dentro de ComparisonSelectionProvider');
  return context;
}

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, usePathname, useRouter, useSearchParams } from '@/lib/router-compat';
import { Button } from '@/components/ui/Button';
import { publicEvolutionHref } from '@/lib/evolution-utils';
import styles from './evolution-selection.module.css';

export type EvolutionSelectionItem = { slug: string; title: string };

type EvolutionSelectionContextValue = {
  items: EvolutionSelectionItem[];
  message: string | null;
  toggle: (item: EvolutionSelectionItem) => void;
  replace: (items: EvolutionSelectionItem[]) => void;
  clear: () => void;
};

const MAX_ITEMS = 50;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const STORAGE_KEY = 'galilei.public-evolution-selection.v1';
const EvolutionSelectionContext = createContext<EvolutionSelectionContextValue | null>(null);

function readStoredSelection(): EvolutionSelectionItem[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, EvolutionSelectionItem>();
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || !('slug' in item) || !('title' in item)) continue;
      const slug = item.slug;
      const title = item.title;
      if (typeof slug !== 'string' || !SLUG.test(slug) || typeof title !== 'string') continue;
      unique.set(slug, { slug, title: title.slice(0, 240) });
      if (unique.size === MAX_ITEMS) break;
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function safeReturnPath(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return '/consulta';
  if (/^\/(consulta|colecciones|favoritos|comparar)(?:\/|\?|$)/u.test(path)) return path;
  return '/consulta';
}

export function EvolutionSelectionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<EvolutionSelectionItem[]>(readStoredSelection);
  const [message, setMessage] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState('/consulta');

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // The selection still works for the current page if browser storage is unavailable.
    }
  }, [items]);

  const toggle = useCallback((item: EvolutionSelectionItem) => {
    if (!SLUG.test(item.slug)) return;
    const existing = items.some((candidate) => candidate.slug === item.slug);
    setMessage(null);
    if (existing) {
      const next = items.filter((candidate) => candidate.slug !== item.slug);
      setItems(next);
      if (pathname === '/evolucion') router.replace(publicEvolutionHref(next.map((item) => item.slug)));
      return;
    }
    if (items.length >= MAX_ITEMS) {
      setMessage('La línea de tiempo admite hasta 50 fallos. Quitá uno para agregar otro.');
      return;
    }
    if (items.length === 0 && pathname !== '/evolucion') {
      const search = searchParams.toString();
      setReturnTo(safeReturnPath(`${pathname}${search ? `?${search}` : ''}`));
    }
    const next = [...items, { slug: item.slug, title: item.title.slice(0, 240) }];
    setItems(next);
    if (pathname === '/evolucion') router.replace(publicEvolutionHref(next.map((candidate) => candidate.slug)));
  }, [items, pathname, router, searchParams]);

  const replace = useCallback((nextItems: EvolutionSelectionItem[]) => {
    const unique = new Map<string, EvolutionSelectionItem>();
    for (const item of nextItems) {
      if (!SLUG.test(item.slug)) continue;
      unique.set(item.slug, { slug: item.slug, title: item.title.slice(0, 240) });
      if (unique.size === MAX_ITEMS) break;
    }
    setItems([...unique.values()]);
    setMessage(null);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setMessage(null);
    if (pathname === '/evolucion') router.replace('/evolucion');
  }, [pathname, router]);

  const value = useMemo(() => ({ items, message, toggle, replace, clear }), [items, message, toggle, replace, clear]);

  return (
    <EvolutionSelectionContext.Provider value={value}>
      {children}
      {items.length > 0 ? (
        <aside className={styles.tray} aria-label="Fallos seleccionados para evolución">
          <div className={styles.summary}>
            <strong>Evolución jurisprudencial</strong>
            <span>{items.length} de {MAX_ITEMS} fallos</span>
            <details className={styles.removeList}>
              <summary>Administrar selección</summary>
              <ul>
                {items.map((item) => (
                  <li key={item.slug}>
                    <span title={item.title}>{item.title}</span>
                    <button type="button" aria-label={`Quitar ${item.title}`} onClick={() => toggle(item)}>Quitar</button>
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <div className={styles.actions}>
            {message ? <span role="status" className={styles.message}>{message}</span> : null}
            <Button variant="ghost" onClick={clear}>Vaciar</Button>
            <Link href={publicEvolutionHref(items.map((item) => item.slug))} state={{ evolutionReturnTo: returnTo }}>
              <Button variant="secondary">Abrir evolución</Button>
            </Link>
          </div>
        </aside>
      ) : null}
    </EvolutionSelectionContext.Provider>
  );
}

export function useEvolutionSelection() {
  const context = useContext(EvolutionSelectionContext);
  if (!context) throw new Error('useEvolutionSelection debe usarse dentro de EvolutionSelectionProvider');
  return context;
}

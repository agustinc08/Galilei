'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '@/lib/router-compat';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { ApiResponse } from '@/types/common';
import styles from '@/components/research/research-collections.module.css';

type CollectionItem = {
  id: number;
  nota: string | null;
  sentencia: {
    id: number;
    slugPublico: string | null;
    caratula: string | null;
    numeroSentencia: string | null;
    expediente: string | null;
    sala: string | null;
    fecha: string | null;
    tipoFallo: string | null;
  };
};

type CollectionDetail = {
  id: number;
  nombre: string;
  items: CollectionItem[];
};

type PageMeta = { total: number; page: number; pageSize: number; pageCount: number };

export default function ResearchCollectionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isSafeInteger(id) && id > 0;
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, pageSize: 25, pageCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Set<number>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!validId) return;
    let active = true;
    void api.get<ApiResponse<CollectionDetail> & { meta: PageMeta }>(
      `/research/collections/${id}`,
      { query: { q: searchQuery || undefined, page, pageSize: 25 } },
    ).then((response) => {
      if (!active) return;
      setError(null);
      setCollection(response.data);
      setMeta(response.meta);
      setNameDraft(response.data.nombre);
      setDraftNotes(Object.fromEntries(response.data.items.map((item) => [item.id, item.nota ?? ''])));
    }).catch(() => {
      if (active) setError('No se pudo abrir esta colección. Puede que no exista o no pertenezca a tu cuenta.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, page, reloadKey, searchQuery, validId]);

  const returnTo = useMemo(() => `/colecciones/${id}`, [id]);

  const rename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nombre = nameDraft.trim();
    if (!nombre) return;
    setError(null);
    setMessage(null);
    try {
      const response = await api.patch<ApiResponse<CollectionDetail>>(`/research/collections/${id}`, { nombre });
      setCollection((current) => current ? { ...current, nombre: response.data.nombre } : current);
      setNameDraft(response.data.nombre);
      setMessage('Nombre de la colección actualizado.');
    } catch {
      setError('No se pudo renombrar la colección. Revisá si ya existe otra con ese nombre.');
    }
  };

  const saveNote = async (itemId: number) => {
    setSavingNoteIds((current) => new Set(current).add(itemId));
    setError(null);
    setMessage(null);
    try {
      await api.patch(`/research/collections/${id}/items/${itemId}/note`, { nota: draftNotes[itemId] ?? '' });
      setMessage('Nota privada guardada.');
      setReloadKey((current) => current + 1);
    } catch {
      setError('No se pudo guardar la nota.');
    } finally {
      setSavingNoteIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  const removeItem = async (itemId: number) => {
    setError(null);
    setMessage(null);
    try {
      await api.delete(`/research/collections/${id}/items/${itemId}`);
      setMessage('Fallo quitado de la colección. El documento original sigue disponible.');
      setReloadKey((current) => current + 1);
    } catch {
      setError('No se pudo quitar el fallo de la colección.');
    }
  };

  const removeCollection = async () => {
    setError(null);
    try {
      await api.delete(`/research/collections/${id}`);
      window.location.assign('/colecciones');
    } catch {
      setError('No se pudo eliminar la colección.');
    }
  };

  const applySearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearchQuery(searchDraft.trim());
  };

  if (!validId) {
    return <StatusMessage variant="error" title="Colección no disponible" message="La dirección de la colección no es válida." />;
  }
  if (loading && !collection) return <LoadingSpinner label="Cargando colección…" />;
  if (error && !collection) return <StatusMessage variant="error" title="Colección no disponible" message={error} />;
  if (!collection) return <EmptyState title="Colección no disponible" description="No encontramos una colección propia con esa dirección." />;

  return (
    <section className={styles.collectionPage}>
      <Link href="/colecciones"><Button variant="ghost">Volver a mis colecciones</Button></Link>
      <PageHeader title={collection.nombre} description="Colección privada. Los fallos se guardan como referencias; sus PDFs no se duplican." />
      {error ? <StatusMessage variant="error" title="No se pudo completar" message={error} /> : null}
      {message ? <StatusMessage variant="success" title="Listo" message={message} /> : null}

      <div className={styles.collectionToolbar}>
        <form className={styles.collectionForm} onSubmit={(event) => void rename(event)}>
          <label htmlFor="collection-name">Nombre de la colección</label>
          <input id="collection-name" value={nameDraft} maxLength={100} onChange={(event) => setNameDraft(event.target.value)} required />
          <Button type="submit" variant="secondary" disabled={!nameDraft.trim() || nameDraft.trim() === collection.nombre}>Renombrar</Button>
        </form>
        <details>
          <summary>Eliminar colección</summary>
          <p>Se quitarán sus referencias y notas privadas. Los fallos originales no se eliminan.</p>
          <Button variant="danger" onClick={() => void removeCollection()}>Eliminar colección</Button>
        </details>
      </div>

      <form className={styles.collectionSearch} onSubmit={(event) => applySearch(event)}>
        <label htmlFor="collection-search">Filtrar por datos del fallo o por el texto de tus notas</label>
        <input id="collection-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} placeholder="Carátula, expediente, Sala o nota" />
        <div className={styles.collectionActions}>
          <Button type="submit">Buscar en colección</Button>
          {searchQuery ? <Button type="button" variant="secondary" onClick={() => { setSearchDraft(''); setSearchQuery(''); setPage(1); }}>Limpiar filtro</Button> : null}
        </div>
      </form>

      {loading ? <LoadingSpinner label="Actualizando fallos…" /> : collection.items.length === 0 ? (
        <EmptyState title={searchQuery ? 'Sin coincidencias en esta colección' : 'La colección está vacía'} description={searchQuery ? 'Probá otro término o limpiá el filtro.' : 'Agregá fallos desde sus resultados o fichas públicas.'} />
      ) : (
        <div className={styles.collectionGrid}>
          {collection.items.map((item) => {
            const title = item.sentencia.caratula || item.sentencia.numeroSentencia || `Fallo ${item.sentencia.id}`;
            const sentenceHref = item.sentencia.slugPublico
              ? `/consulta/sentencia/${encodeURIComponent(item.sentencia.slugPublico)}?returnTo=${encodeURIComponent(returnTo)}`
              : `/consulta/sentencia/${item.sentencia.id}?returnTo=${encodeURIComponent(returnTo)}`;
            return (
              <article className={styles.collectionItem} key={item.id}>
                <div className={styles.collectionItemHeader}>
                  <h2><Link href={sentenceHref}>{title}</Link></h2>
                  <Button variant="ghost" onClick={() => void removeItem(item.id)}>Quitar de colección</Button>
                </div>
                <p className={styles.collectionItemMeta}>
                  {[item.sentencia.sala, item.sentencia.fecha ? new Date(item.sentencia.fecha).toLocaleDateString('es-AR') : null, item.sentencia.expediente ? `Expte. ${item.sentencia.expediente}` : null, item.sentencia.numeroSentencia ? `Sentencia ${item.sentencia.numeroSentencia}` : null].filter(Boolean).join(' · ') || 'Sin metadatos adicionales'}
                </p>
                <div className={styles.noteEditor}>
                  <label htmlFor={`note-${item.id}`}>Nota privada sobre este fallo</label>
                  <textarea
                    id={`note-${item.id}`}
                    value={draftNotes[item.id] ?? ''}
                    maxLength={5000}
                    onChange={(event) => setDraftNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Anotá por qué te sirve o qué considerando revisar…"
                  />
                  <Button variant="secondary" disabled={savingNoteIds.has(item.id)} onClick={() => void saveNote(item.id)}>
                    {savingNoteIds.has(item.id) ? 'Guardando…' : 'Guardar nota'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {meta.pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Páginas de la colección">
          <Button variant="secondary" disabled={meta.page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
          <span>Página {meta.page} de {meta.pageCount} · {meta.total} fallos</span>
          <Button variant="secondary" disabled={meta.page >= meta.pageCount} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
        </nav>
      ) : null}
    </section>
  );
}

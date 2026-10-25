'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/lib/router-compat';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { ApiResponse } from '@/types/common';
import styles from '@/components/research/research-collections.module.css';

type CollectionSummary = {
  id: number;
  nombre: string;
  itemCount: number;
  updatedAt: string;
};

export default function ResearchCollectionsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ApiResponse<CollectionSummary[]>>('/research/collections');
      setCollections(response.data);
    } catch {
      setError('No pudimos cargar tus colecciones. Volvé a intentarlo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api.get<ApiResponse<CollectionSummary[]>>('/research/collections')
      .then((response) => { if (active) setCollections(response.data); })
      .catch(() => { if (active) setError('No pudimos cargar tus colecciones. Volvé a intentarlo.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nombre = name.trim();
    if (!nombre) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.post('/research/collections', { nombre });
      setName('');
      setMessage('Colección privada creada.');
      await load();
    } catch {
      setError('No se pudo crear la colección. Revisá si ya existe una con ese nombre.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.collectionPage}>
      <PageHeader title="Mis colecciones" description="Organizá fallos para tu investigación. Las colecciones y notas son privadas de tu cuenta." />
      <Card>
        <form className={styles.collectionForm} onSubmit={(event) => void create(event)}>
          <label htmlFor="new-research-collection">Crear colección</label>
          <input
            id="new-research-collection"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="Ej.: Responsabilidad civil"
            required
          />
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Creando…' : 'Crear colección'}</Button>
        </form>
      </Card>
      {error ? <StatusMessage variant="error" title="No se pudo completar" message={error} /> : null}
      {message ? <StatusMessage variant="success" title="Listo" message={message} /> : null}
      {loading ? <LoadingSpinner label="Cargando colecciones…" /> : collections.length === 0 ? (
        <EmptyState title="Todavía no tenés colecciones" description="Creá una colección y agregá fallos desde los resultados o sus fichas." />
      ) : (
        <div className={styles.collectionGrid}>
          {collections.map((collection) => (
            <article className={styles.collectionCard} key={collection.id}>
              <h2><Link href={`/colecciones/${collection.id}`}>{collection.nombre}</Link></h2>
              <p>{collection.itemCount} {collection.itemCount === 1 ? 'fallo' : 'fallos'}</p>
              <p>Actualizada {new Date(collection.updatedAt).toLocaleDateString('es-AR')}</p>
              <Link href={`/colecciones/${collection.id}`}><Button variant="secondary">Abrir colección</Button></Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

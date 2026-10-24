'use client';

import { Link } from "@/lib/router-compat";
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import styles from './digesto.module.css';

type Collection = { id: string; name: string; description: string | null; _count: { memberships: number } };

export default function DigestoPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Collection[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topicName, setTopicName] = useState('');
  const [tagName, setTagName] = useState('');
  const [error, setError] = useState('');
  const canEditCatalog = ['ADMIN', 'DIGESTO'].includes(user?.rol.nombre ?? '');
  const load = useCallback(async () => {
    try { setItems(await api.get<Collection[]>('/corpus/curation/digesto/collections')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las colecciones.'); }
  }, []);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/corpus/curation/digesto/collections', { name, description });
      setName(''); setDescription(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la colección.'); }
  };
  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    try { await api.post('/corpus/curation/digesto/topics', { name: topicName }); setTopicName(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el tema.'); }
  };
  const createTag = async (event: FormEvent) => {
    event.preventDefault();
    try { await api.post('/corpus/curation/digesto/tags', { name: tagName }); setTagName(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la etiqueta.'); }
  };

  return <main className={styles.page}>
    <PageHeader title="Digesto" description="Organizá documentos del repositorio en colecciones temáticas. La colección enlaza el documento existente; no crea otra copia del PDF." />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {canEditCatalog ? <Card><h2>Nueva colección</h2><form className={styles.form} onSubmit={create}>
      <label>Nombre<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Descripción<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <button type="submit">Crear colección</button>
    </form></Card> : null}
    {canEditCatalog ? <Card><h2>Catálogos controlados</h2><div className={styles.formGroup}>
      <form className={styles.form} onSubmit={createTopic}><label>Nuevo tema<input required maxLength={120} value={topicName} onChange={(event) => setTopicName(event.target.value)} /></label><button type="submit">Crear tema</button></form>
      <form className={styles.form} onSubmit={createTag}><label>Nueva etiqueta<input required maxLength={80} value={tagName} onChange={(event) => setTagName(event.target.value)} /></label><button type="submit">Crear etiqueta</button></form>
    </div></Card> : null}
    <section className={styles.grid} aria-label="Colecciones Digesto">
      {items.map((item) => <Card key={item.id}><Link href={`/digesto/${encodeURIComponent(item.id)}`} className={styles.collectionLink}>
        <span className={styles.kicker}>Colección</span><h2>{item.name}</h2>
        {item.description ? <p>{item.description}</p> : null}
        <span>{item._count.memberships.toLocaleString('es-AR')} documentos</span>
      </Link></Card>)}
      {!items.length && !error ? <Card><h2>Aún no hay colecciones</h2><p>Los documentos se agregan luego de revisar su pertinencia. No se importaron automáticamente categorías del Digesto legado.</p></Card> : null}
    </section>
  </main>;
}

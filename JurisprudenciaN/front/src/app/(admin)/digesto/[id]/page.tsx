'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { api } from '@/lib/api';
import styles from '../digesto.module.css';

type CollectionView = { id: string; name: string; description: string | null; total: number; page: number; pageSize: number; documents: Array<{ id: string; title: string; court: string | null; chamber: string | null; caseNumber: string | null; decisionDate: string | null }> };

export default function DigestoCollectionPage() {
  const params = useParams<{ id: string }>();
  const [collection, setCollection] = useState<CollectionView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.get<CollectionView>(`/corpus/curation/digesto/collections/${params.id}`).then(setCollection).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo abrir la colección.')); }, [params.id]);
  return <main className={styles.page}>
    <Link href="/digesto" className={styles.back}>← Colecciones</Link>
    <PageHeader title={collection?.name ?? 'Colección'} description={collection?.description ?? `${collection?.total ?? '—'} documentos relacionados`} />
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <Card><h2>Documentos ({collection?.total.toLocaleString('es-AR') ?? '—'})</h2>
      {collection?.documents.length ? <ul className={styles.list}>{collection.documents.map((doc) => <li key={doc.id}>
        <Link href={`/corpus/${encodeURIComponent(doc.id)}`}>{doc.title}</Link>
        <span> · {[doc.caseNumber, doc.court, doc.chamber, doc.decisionDate ? new Date(doc.decisionDate).toLocaleDateString('es-AR') : null].filter(Boolean).join(' · ')}</span>
      </li>)}</ul> : <p>Esta colección todavía no tiene documentos vinculados.</p>}
    </Card>
  </main>;
}

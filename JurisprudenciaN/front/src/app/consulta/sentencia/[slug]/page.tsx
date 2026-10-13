'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { CopyButton } from '@/components/ui/CopyButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { PrintButton } from '@/components/ui/PrintButton';
import { ShareLinkButton } from '@/components/ui/ShareLinkButton';
import { CopyReferenceButton } from '@/components/sentencias/CopyReferenceButton';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type { PublicSentencia } from '@/types/sentencia';

export default function ConsultaSentenciaPublicaPage() {
  const params = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicSentencia | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await api.get<ApiResponse<PublicSentencia>>(`/public/sentencias/${params.slug}`, {
          skipAuth: true,
        });
        if (active) {
          setData(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la sentencia.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [params.slug]);

  if (isLoading) {
    return <LoadingSpinner label="Cargando sentencia pública..." />;
  }

  if (!data) {
    return <EmptyState title="Sentencia no disponible" description={error ?? 'No se encontró contenido público.'} />;
  }

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'grid', gap: 24 }}>
      <section className={styles.section}>
        <h1 style={{ fontSize: 30 }}>{data.cita.citaBreve}</h1>
        <div className={styles.badgeRow}>
          {data.sala ? <span className={styles.badge}>{data.sala}</span> : null}
          <span className={styles.badge}>{formatDate(data.fecha)}</span>
          {data.archivosPdf.length > 0 ? <span className={styles.badge}>Con PDF</span> : null}
        </div>
        <div className={styles.inlineActions}>
          <CopyButton value={data.cita.citaCopiable} label="Copiar cita" />
          <ShareLinkButton url={currentUrl} label="Copiar enlace" sentenciaId={data.id} />
          <Button
            variant="secondary"
            onClick={() =>
              window.open(`/consulta/sentencia/${params.slug}/documento`, '_blank', 'noopener')
            }
          >
            Ver documento
          </Button>
          <PrintButton
            onPrint={() =>
              window.open(`/consulta/sentencia/${params.slug}/ficha`, '_blank', 'noopener')
            }
          />
          <Button variant="secondary" onClick={() => window.print()}>
            Imprimir página
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <strong>Resumen</strong>
        <p>{data.resumen ?? 'Sin resumen publicado.'}</p>
      </section>

      {data.resena ? (
        <section className={styles.section}>
          <strong>Reseña</strong>
          <p>{data.resena}</p>
        </section>
      ) : null}

      {data.citasFallo?.length ? (
        <section className={styles.section}>
          <strong>Este fallo cita a</strong>
          <div className={styles.listGrid}>
            {data.citasFallo.map((citaItem) => (
              <article key={citaItem.id} className={styles.listItem}>
                <strong>
                  {citaItem.tipo} | {citaItem.referencia}
                </strong>
                {citaItem.contexto ? <p>{citaItem.contexto}</p> : null}
                <div className={styles.inlineActions}>
                  <CopyReferenceButton referencia={citaItem.referencia} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <strong>Datos basicos</strong>
        <p>Expediente: {data.expediente ?? '-'}</p>
        <p>N° de sentencia: {data.numeroSentencia ?? '-'}</p>
        <p>Tipo de fallo: {data.tipoFallo ?? '-'}</p>
        <p>Caratula: {[data.actor, data.demandado].filter(Boolean).join(' c/ ') || '-'}</p>
      </section>

      <section className={styles.section}>
        <strong>Sumarios</strong>
        <div className={styles.listGrid}>
          {data.sumarios.map((sumario) => (
            <article key={sumario.id} className={styles.listItem}>
              <strong>{sumario.tema ?? `Sumario ${sumario.id}`}</strong>
              <p>{sumario.texto}</p>
            </article>
          ))}
        </div>
      </section>

      {data.referenciasNormativas?.length ? (
        <section className={styles.section}>
          <strong>Normas relacionadas</strong>
          <div className={styles.listGrid}>
            {data.referenciasNormativas.map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>
                  {referencia.tipoNorma}
                  {referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}
                  {referencia.articulo ? ` art. ${referencia.articulo}` : ''}
                  {referencia.inciso ? ` inc. ${referencia.inciso}` : ''}
                </strong>
                {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
                <div className={styles.inlineActions}>
                  {referencia.url ? (
                    <a href={referencia.url} target="_blank" rel="noreferrer">
                      <Button variant="secondary">Abrir norma</Button>
                    </a>
                  ) : null}
                  <CopyReferenceButton
                    referencia={`${referencia.tipoNorma}${referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}${referencia.articulo ? ` art. ${referencia.articulo}` : ''}${referencia.inciso ? ` inc. ${referencia.inciso}` : ''}`}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.referenciasJurisprudenciales?.length ? (
        <section className={styles.section}>
          <strong>Jurisprudencia relacionada</strong>
          <div className={styles.listGrid}>
            {data.referenciasJurisprudenciales.map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>{referencia.referencia}</strong>
                {referencia.textoOriginal ? <p>{referencia.textoOriginal}</p> : null}
                <div className={styles.inlineActions}>
                  <CopyReferenceButton referencia={referencia.referencia} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data.referenciasDoctrinarias?.length ? (
        <section className={styles.section}>
          <strong>Doctrina</strong>
          <div className={styles.listGrid}>
            {data.referenciasDoctrinarias.map((referencia) => (
              <article key={referencia.id} className={styles.listItem}>
                <strong>
                  {[referencia.autor, referencia.titulo].filter(Boolean).join(' - ') || 'Referencia doctrinaria'}
                </strong>
                <p>{[referencia.fuente, referencia.anio].filter(Boolean).join(' | ')}</p>
                {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

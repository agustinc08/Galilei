'use client';

import { useParams } from '@/lib/router-compat';
import { useSearchParams } from '@/lib/router-compat';
import { Link } from "@/lib/router-compat";
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
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import type { ApiResponse } from '@/types/common';
import type { PublicSentencia } from '@/types/sentencia';
import { useComparisonSelection } from '@/components/comparison/ComparisonSelection';

export default function ConsultaSentenciaPublicaPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get('returnTo') ?? '';
  const comparison = useComparisonSelection();
  const backHref = requestedReturn.startsWith('/consulta') ? requestedReturn : '/consulta';
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
    <main style={{ maxWidth: 1040, minWidth: 0, margin: '0 auto', padding: 24, display: 'grid', gap: 18 }}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p style={{ margin: 0, color: '#536b82', fontWeight: 700 }}>Jurisprudencia · Sumario</p>
            <h1 style={{ margin: '6px 0', fontSize: 30, overflowWrap: 'anywhere' }}>{data.caratula || data.cita.citaBreve}</h1>
          </div>
          <Link href={backHref}>
            <Button variant="secondary">Volver a resultados</Button>
          </Link>
        </div>
        <div className={styles.badgeRow}>
          <span className={styles.badge}>{data.sala ? (data.sala.toLowerCase().startsWith('sala') ? data.sala : `Sala ${data.sala}`) : 'Sin Sala informada'}</span>
          {data.fecha ? <span className={styles.badge}>{formatDate(data.fecha)}</span> : null}
          {data.tipoFallo ? <span className={styles.badge}>{formatTipoFallo(data.tipoFallo)}</span> : null}
          {data.archivosPdf.length > 0 ? <span className={styles.badge}>PDF disponible</span> : null}
        </div>
        <div className={styles.inlineActions}>
          <CopyButton value={data.cita.citaCopiable} label="Copiar cita" />
          {data.slugPublico ? (
            <Button
              variant={comparison.items.some((item) => item.slug === data.slugPublico) ? 'secondary' : 'ghost'}
              onClick={() => comparison.toggle({ slug: data.slugPublico!, title: data.caratula || data.numeroSentencia || data.expediente || `Sentencia ${data.id}` })}
            >
              {comparison.items.some((item) => item.slug === data.slugPublico) ? 'Quitar de comparación' : 'Agregar a comparación'}
            </Button>
          ) : null}
          <ShareLinkButton url={currentUrl} label="Copiar enlace" sentenciaId={data.id} />
          {data.archivosPdf.length > 0 ? <Link href={`/fallos/${params.slug}?returnTo=${encodeURIComponent(backHref)}`}><Button>Abrir fallo</Button></Link> : null}
          <PrintButton
            onPrint={() =>
              window.open(`/consulta/sentencia/${params.slug}/ficha`, '_blank', 'noopener')
            }
          />
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
          <strong>Datos del fallo</strong>
          {data.expediente ? <p>Expediente: {data.expediente}</p> : null}
          {data.numeroSentencia ? <p>Nº de sentencia: {data.numeroSentencia}</p> : null}
          {data.tipoFallo ? <p>Tipo: {formatTipoFallo(data.tipoFallo)}</p> : null}
          {data.magistrados ? <p>Magistrados: {data.magistrados}</p> : null}
          {data.tribunalOrigen ? <p>Tribunal de origen: {data.tribunalOrigen}</p> : null}
          {data.sumarios.map((sumario) => sumario.tema).filter((tema): tema is string => Boolean(tema)).length ? (
            <p>Temas: {data.sumarios.map((sumario) => sumario.tema).filter((tema): tema is string => Boolean(tema)).join(', ')}</p>
          ) : null}
      </section>

      <section className={styles.section}>
        <strong>Sumarios</strong>
        {data.sumarios.length ? (
          <div className={styles.listGrid}>
            {data.sumarios.map((sumario) => (
              <article key={sumario.id} className={styles.listItem}>
                <strong>{sumario.tema ?? `Sumario ${sumario.id}`}</strong>
                <p>{sumario.texto}</p>
              </article>
            ))}
          </div>
        ) : <p>No hay sumarios publicados para este fallo.</p>}
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

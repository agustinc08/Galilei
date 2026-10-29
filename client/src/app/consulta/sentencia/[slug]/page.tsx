'use client';

import { useParams } from '@/lib/router-compat';
import { useSearchParams } from '@/lib/router-compat';
import { Link } from "@/lib/router-compat";
import { useEffect, useState } from 'react';
import styles from './sumario-detail.module.css';
import { CopyButton } from '@/components/ui/CopyButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { PrintButton } from '@/components/ui/PrintButton';
import { ShareLinkButton } from '@/components/ui/ShareLinkButton';
import { CopyReferenceButton } from '@/components/sentencias/CopyReferenceButton';
import { api } from '@/lib/api';
import { buildApiUrl } from '@/lib/env';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import type { ApiResponse } from '@/types/common';
import type { PublicSentencia } from '@/types/sentencia';
import { useComparisonSelection } from '@/components/comparison/ComparisonSelection';
import { EvolutionAddButton } from '@/components/evolution/EvolutionAddButton';
import { htmlToPlainText } from '@/lib/html-to-plain-text';

export default function ConsultaSentenciaPublicaPage() {
  const params = useParams<{ slug: string }>();
  const routeSlug = typeof params.slug === 'string' ? params.slug : '';
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
      if (!routeSlug) {
        setError('No se encontró el identificador del fallo.');
        setIsLoading(false);
        return;
      }
      try {
        const response = await api.get<ApiResponse<PublicSentencia>>(`/public/sentencias/${routeSlug}`, {
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
  }, [routeSlug]);

  if (isLoading) {
    return <LoadingSpinner label="Cargando sentencia pública..." />;
  }

  if (!data) {
    return <EmptyState title="Sentencia no disponible" description={error ?? 'No se encontró contenido público.'} />;
  }

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const pdfAvailable = data.archivosPdf.length > 0;
  const pdfHref = pdfAvailable
    ? buildApiUrl(`/public/sentencias/${encodeURIComponent(routeSlug)}/pdf`)
    : null;
  const fullJudgmentHref = `/fallos/${routeSlug}?returnTo=${encodeURIComponent(backHref)}`;
  const title = data.caratula || data.cita.citaBreve;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroTopline}>
          <div>
            <p className={styles.eyebrow}>Jurisprudencia · Sumario</p>
            <h1>{title}</h1>
            <p className={styles.heroCitation}>{data.cita.citaBreve}</p>
          </div>
          <Link className={styles.backLink} href={backHref}>
            <Button variant="secondary">Volver a resultados</Button>
          </Link>
        </div>
        <div className={styles.metaRow} aria-label="Datos principales del fallo">
          <span className={styles.metaBadge}>{data.sala ? (data.sala.toLowerCase().startsWith('sala') ? data.sala : `Sala ${data.sala}`) : 'Sin Sala informada'}</span>
          {data.fecha ? <span className={styles.metaBadge}>{formatDate(data.fecha)}</span> : null}
          {data.expediente ? <span className={styles.metaBadge}>Expte. {data.expediente}</span> : null}
          {data.tipoFallo ? <span className={styles.metaBadge}>{formatTipoFallo(data.tipoFallo)}</span> : null}
          {pdfAvailable ? <span className={`${styles.metaBadge} ${styles.pdfBadge}`}>PDF disponible</span> : <span className={`${styles.metaBadge} ${styles.missingPdfBadge}`}>Sin PDF</span>}
        </div>
        <div className={styles.actions}>
          <CopyButton value={data.cita.citaCopiable} label="Copiar cita" />
          {data.slugPublico ? (
            <Button
              variant={comparison.items.some((item) => item.slug === data.slugPublico) ? 'secondary' : 'ghost'}
              onClick={() => comparison.toggle({ slug: data.slugPublico!, title: title || data.numeroSentencia || data.expediente || `Sentencia ${data.id}` })}
            >
              {comparison.items.some((item) => item.slug === data.slugPublico) ? 'Quitar de comparación' : 'Agregar a comparación'}
            </Button>
          ) : null}
          {data.slugPublico ? <EvolutionAddButton slug={data.slugPublico} title={title || data.numeroSentencia || data.expediente || `Sentencia ${data.id}`} /> : null}
          <ShareLinkButton url={currentUrl} label="Copiar enlace" sentenciaId={data.id} />
          <PrintButton onPrint={() => window.open(`/consulta/sentencia/${params.slug}/ficha`, '_blank', 'noopener')} />
        </div>
      </header>

      <div className={styles.detailGrid}>
        <div className={styles.contentColumn}>
          <section className={styles.panel} id="sumarios" aria-labelledby="summary-heading">
            <div className={styles.panelHeading}>
              <h2 id="summary-heading">Sumarios del fallo</h2>
              <span>{data.sumarios.length} {data.sumarios.length === 1 ? 'sumario' : 'sumarios'}</span>
            </div>
            {data.sumarios.length ? (
              <div className={styles.summaryList}>
                {data.sumarios.map((sumario, index) => (
                  <article key={sumario.id} className={styles.summaryCard}>
                    <h3 className={styles.summaryTopic}>{sumario.tema || sumario.numeroSumario || `Sumario ${index + 1}`}</h3>
                    <p className={styles.summaryText}>{htmlToPlainText(sumario.texto)}</p>
                  </article>
                ))}
              </div>
            ) : <p className={styles.emptyNote}>No hay sumarios publicados para este fallo.</p>}
          </section>

          {data.resumen ? <section className={styles.panel}><div className={styles.panelHeading}><h2>Resumen</h2></div><p className={styles.plainText}>{data.resumen}</p></section> : null}
          {data.resena ? <section className={styles.panel}><div className={styles.panelHeading}><h2>Reseña</h2></div><p className={styles.plainText}>{data.resena}</p></section> : null}

          <section className={styles.panel}>
            <div className={styles.panelHeading}><h2>Datos del fallo</h2></div>
            <dl className={styles.relatedMeta}>
              {data.expediente ? <><dt>Expediente</dt><dd>{data.expediente}</dd></> : null}
              {data.numeroSentencia ? <><dt>Número</dt><dd>{data.numeroSentencia}</dd></> : null}
              {data.magistrados ? <><dt>Magistrados</dt><dd>{data.magistrados}</dd></> : null}
              {data.tribunalOrigen ? <><dt>Tribunal de origen</dt><dd>{data.tribunalOrigen}</dd></> : null}
              {data.sumarios.map((sumario) => sumario.tema).filter((tema): tema is string => Boolean(tema)).length ? <><dt>Temas</dt><dd>{data.sumarios.map((sumario) => sumario.tema).filter((tema): tema is string => Boolean(tema)).join(', ')}</dd></> : null}
            </dl>
          </section>

          {data.citasFallo?.length ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><h2>Este fallo cita a</h2></div>
              <div className={styles.listGrid}>
                {data.citasFallo.map((citaItem) => (
                  <article key={citaItem.id} className={styles.listItem}>
                    <strong>{citaItem.tipo} | {citaItem.referencia}</strong>
                    {citaItem.contexto ? <p>{citaItem.contexto}</p> : null}
                    <div className={styles.inlineActions}><CopyReferenceButton referencia={citaItem.referencia} /></div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.referenciasNormativas?.length ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><h2>Normas relacionadas</h2></div>
              <div className={styles.listGrid}>
                {data.referenciasNormativas.map((referencia) => (
                  <article key={referencia.id} className={styles.listItem}>
                    <strong>{referencia.tipoNorma}{referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}{referencia.articulo ? ` art. ${referencia.articulo}` : ''}{referencia.inciso ? ` inc. ${referencia.inciso}` : ''}</strong>
                    {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
                    <div className={styles.inlineActions}>
                      {referencia.url ? <a href={referencia.url} target="_blank" rel="noreferrer"><Button variant="secondary">Abrir norma</Button></a> : null}
                      <CopyReferenceButton referencia={`${referencia.tipoNorma}${referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}${referencia.articulo ? ` art. ${referencia.articulo}` : ''}${referencia.inciso ? ` inc. ${referencia.inciso}` : ''}`} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.referenciasJurisprudenciales?.length ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><h2>Jurisprudencia relacionada</h2></div>
              <div className={styles.listGrid}>
                {data.referenciasJurisprudenciales.map((referencia) => (
                  <article key={referencia.id} className={styles.listItem}>
                    <strong>{referencia.referencia}</strong>
                    {referencia.textoOriginal ? <p>{referencia.textoOriginal}</p> : null}
                    <div className={styles.inlineActions}><CopyReferenceButton referencia={referencia.referencia} /></div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.referenciasDoctrinarias?.length ? (
            <section className={styles.panel}>
              <div className={styles.panelHeading}><h2>Doctrina</h2></div>
              <div className={styles.listGrid}>
                {data.referenciasDoctrinarias.map((referencia) => (
                  <article key={referencia.id} className={styles.listItem}>
                    <strong>{[referencia.autor, referencia.titulo].filter(Boolean).join(' - ') || 'Referencia doctrinaria'}</strong>
                    <p>{[referencia.fuente, referencia.anio].filter(Boolean).join(' | ')}</p>
                    {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className={`${styles.panel} ${styles.relatedPanel}`} aria-label="Fallo relacionado">
          <p className={styles.relatedLabel}>FALLO RELACIONADO</p>
          <h2>{title}</h2>
          <dl className={styles.relatedMeta}>
            <dt>Sala</dt><dd>{data.sala ? (data.sala.toLowerCase().startsWith('sala') ? data.sala : `Sala ${data.sala}`) : 'No informada'}</dd>
            <dt>Fecha</dt><dd>{data.fecha ? formatDate(data.fecha) : 'No informada'}</dd>
            <dt>Expediente</dt><dd>{data.expediente || 'No informado'}</dd>
            <dt>PDF</dt><dd>{pdfAvailable ? 'Disponible' : 'No disponible'}</dd>
          </dl>
          <div className={styles.relatedActions}>
            {pdfAvailable ? <Link href={fullJudgmentHref}><Button>Abrir fallo completo</Button></Link> : <p className={styles.emptyNote}>Este fallo no tiene un PDF asociado.</p>}
            {pdfHref ? <a className={styles.pdfLink} href={pdfHref} target="_blank" rel="noreferrer">Abrir PDF</a> : null}
            <Link href={backHref}><Button variant="secondary">Volver a la búsqueda</Button></Link>
          </div>
        </aside>
      </div>
    </main>
  );
}

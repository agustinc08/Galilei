'use client';

import { useState } from 'react';
import { Link } from "@/lib/router-compat";
import { useSearchParams } from '@/lib/router-compat';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { HighlightText } from './HighlightText';
import type { ConsultaPublicaResultado } from '@/types/busqueda';
import { trackEvento } from '@/lib/tracking';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';
import { FavoriteButton } from '@/components/ui/FavoriteButton';
import { api } from '@/lib/api';
import { buildApiUrl } from '@/lib/env';
import { htmlToPlainText } from '@/lib/html-to-plain-text';
import { copyToClipboard } from '@/lib/utils';
import type { PublicSentencia } from '@/types/sentencia';
import { AddToCollectionButton } from '@/components/research/AddToCollectionButton';
import { useComparisonSelection } from '@/components/comparison/ComparisonSelection';
import { EvolutionAddButton } from '@/components/evolution/EvolutionAddButton';

type Props = {
  item: ConsultaPublicaResultado;
  selected: boolean;
  onToggle: (id: number) => void;
  onMissingPdf: () => void;
  query?: string;
  canFavorite?: boolean;
  favorite?: boolean;
  favoriteReady?: boolean;
  favoritePending?: boolean;
  onToggleFavorite?: (id: number) => void | Promise<void>;
  canAddToCollection?: boolean;
};

export function ConsultaResultadoCard({
  item,
  selected,
  onToggle,
  onMissingPdf,
  query,
  canFavorite = false,
  favorite = false,
  favoriteReady = true,
  favoritePending = false,
  onToggleFavorite,
  canAddToCollection = false,
}: Props) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyingCitation, setCopyingCitation] = useState(false);
  const comparison = useComparisonSelection();
  const searchParams = useSearchParams();
  const returnTo = `/consulta${searchParams.size ? `?${searchParams.toString()}` : ''}`;
  const detailQuery = new URLSearchParams({ returnTo });
  if (query) detailQuery.set('q', query);
  const publicIdentifier = item.slugPublico ?? String(item.sentenciaId ?? item.id);
  const hasPdf = item.pdfDisponible === true || Boolean(item.archivoPdfId);
  const summaryCount = Math.max(1, Math.trunc(Number(item.cantidadSumarios ?? 1)));
  const inComparison = Boolean(item.slugPublico && comparison.items.some((candidate) => candidate.slug === item.slugPublico));
  const detailHref = publicIdentifier
    ? `/consulta/sentencia/${publicIdentifier}?${detailQuery.toString()}#sumarios`
    : null;
  const documentHref = publicIdentifier ? `/fallos/${publicIdentifier}?${detailQuery.toString()}` : null;
  const pdfHref = hasPdf
    ? buildApiUrl(`/public/sentencias/${encodeURIComponent(publicIdentifier)}/pdf`)
    : null;

  const copyCitation = async () => {
    if (!item.slugPublico || copyingCitation) return;
    setCopyingCitation(true);
    setCopyMessage(null);
    try {
      const response = await api.get<{ data: PublicSentencia }>(
        `/public/sentencias/${encodeURIComponent(item.slugPublico)}`,
        { skipAuth: true },
      );
      const citation = response.data.cita?.citaCopiable?.trim();
      if (!citation) {
        setCopyMessage('La ficha pública no incluye una cita copiable.');
        return;
      }
      const sourceUrl = `${window.location.origin}/consulta/sentencia/${encodeURIComponent(item.slugPublico)}`;
      const copied = await copyToClipboard(`${citation}\nFuente Galilei: ${sourceUrl}`);
      setCopyMessage(copied ? 'Cita y enlace de Galilei copiados.' : 'El navegador no permitió copiar. Seleccioná y copiá el texto desde la ficha del fallo.');
    } catch {
      setCopyMessage('No pudimos obtener la cita pública de este fallo.');
    } finally {
      setCopyingCitation(false);
    }
  };

  return (
    <article
      className={`${styles.resultCard} ${selected ? styles.resultCardSelected : ''}`}
    >
      <div className={styles.resultMain}>
        <div className={styles.badges}>
          <span className={styles.badge}>{item.esFalloCorpus ? 'Fallo civil' : 'Sumario'}</span>
          {item.numeroSumario ? <span className={styles.badge}>Nº {item.numeroSumario}</span> : null}
          {hasPdf ? <span className={styles.badge}>PDF disponible</span> : null}
          {!hasPdf ? <span className={styles.badgeMuted}>Sin PDF</span> : null}
          {!item.esFalloCorpus && summaryCount > 1 ? <span className={styles.summaryCount}>{summaryCount} sumarios en este fallo</span> : null}
        </div>

        <h2 className={styles.resultTitle}>
          {detailHref ? <Link href={detailHref}>{item.caratula || item.expediente || item.numeroSentencia || 'Fallo sin carátula'}</Link> : (item.caratula || item.expediente || item.numeroSentencia || 'Fallo sin carátula')}
        </h2>
        <p className={styles.resultMeta}>
          {[item.sala ? (item.sala.toLowerCase().startsWith('sala') ? item.sala : `Sala ${item.sala}`) : 'Sin Sala informada', formatDate(item.fecha), formatTipoFallo(item.tipoFallo), item.expediente ? `Expte. ${item.expediente}` : null, item.numeroSentencia ? `Sentencia ${item.numeroSentencia}` : null]
            .filter(Boolean).join(' · ')}
        </p>
        {item.magistrados ? <p className={styles.resultJudges}><strong>Magistrados:</strong> {item.magistrados}</p> : null}

        <div className={styles.sumarioBox}>
          <div className={styles.sumarioHeading}>
            <span>SUMARIO</span>
            <strong className={styles.theme}>{item.esFalloCorpus ? 'Extracto del fallo' : (item.tema || 'Sumario')}</strong>
          </div>
          <p className={styles.sumarioText}>{htmlToPlainText(item.esFalloCorpus ? item.extractoFallo : item.textoSumario)}</p>
        </div>

        {item.highlights.length > 0 ? (
          <div className={styles.highlightGroup}>
            {item.highlights.map((highlight) => (
              <div key={`${item.id}-${highlight.campo}-${highlight.texto}`}>
                <div className={styles.highlightLabel}>{highlight.campo}</div>
                <HighlightText html={highlight.texto} />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className={styles.resultAside}>
        <div className={styles.primaryResultActions}>
          {detailHref ? (
            <Link href={detailHref}>
              <Button variant="secondary">{item.esFalloCorpus ? 'Ver fallo' : summaryCount > 1 ? `Ver ${summaryCount} sumarios` : 'Ver sumario'}</Button>
            </Link>
          ) : null}
          {documentHref && hasPdf ? (
            <Link href={documentHref} onClick={() => void trackEvento({ tipoEvento: 'view_documento', metadata: { origen: 'consulta', slug: publicIdentifier } })}>
              <Button>Ver fallo</Button>
            </Link>
          ) : null}
          {pdfHref && hasPdf ? <a className={styles.pdfAction} href={pdfHref} target="_blank" rel="noreferrer">Abrir PDF</a> : null}
        </div>
        {!hasPdf ? <Button variant="secondary" onClick={onMissingPdf}>Por qué no hay PDF</Button> : null}
        <details className={styles.moreResultActions}>
          <summary>Más acciones</summary>
          <div>
            {canFavorite && onToggleFavorite ? (
              <FavoriteButton
                active={favorite}
                onToggle={() => onToggleFavorite(item.sentenciaId ?? item.id)}
                disabled={favoritePending || !favoriteReady}
              />
            ) : null}
            {canAddToCollection ? <AddToCollectionButton sentenciaId={item.sentenciaId ?? item.id} /> : null}
            {item.slugPublico ? (
              <Button variant={inComparison ? 'secondary' : 'ghost'} onClick={() => comparison.toggle({ slug: item.slugPublico!, title: item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.id}` })}>
                {inComparison ? 'Quitar de comparación' : 'Agregar a comparación'}
              </Button>
            ) : null}
            {item.slugPublico ? <EvolutionAddButton slug={item.slugPublico} title={item.caratula || item.numeroSentencia || item.expediente || `Sentencia ${item.id}`} /> : null}
            {item.slugPublico ? (
              <Button variant="ghost" onClick={() => void copyCitation()} disabled={copyingCitation}>
                {copyingCitation ? 'Copiando cita…' : 'Copiar cita'}
              </Button>
            ) : null}
            <Button
              variant={selected ? 'secondary' : 'ghost'}
              className={styles.printSelect}
              onClick={() => onToggle(item.id)}
            >
              {selected ? 'Quitar de impresión' : 'Seleccionar para imprimir'}
            </Button>
          </div>
        </details>
        {copyMessage ? <span role="status" className={styles.mutedText}>{copyMessage}</span> : null}
      </aside>
    </article>
  );
}

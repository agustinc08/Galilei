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
import { copyToClipboard } from '@/lib/utils';
import type { PublicSentencia } from '@/types/sentencia';

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
}: Props) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyingCitation, setCopyingCitation] = useState(false);
  const searchParams = useSearchParams();
  const returnTo = `/consulta${searchParams.size ? `?${searchParams.toString()}` : ''}`;
  const detailQuery = new URLSearchParams({ returnTo });
  if (query) detailQuery.set('q', query);
  const publicIdentifier = item.slugPublico ?? String(item.sentenciaId ?? item.id);
  const hasPdf = item.pdfDisponible === true || Boolean(item.archivoPdfId);
  const detailHref = publicIdentifier
    ? `/consulta/sentencia/${publicIdentifier}?${detailQuery.toString()}`
    : null;
  const documentHref = publicIdentifier ? `/fallos/${publicIdentifier}?${detailQuery.toString()}` : null;

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
          <strong className={styles.theme}>{item.esFalloCorpus ? 'Extracto del fallo' : (item.tema || 'Sumario')}</strong>
          <p className={styles.sumarioText}>{item.esFalloCorpus ? item.extractoFallo : item.textoSumario}</p>
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
        {canFavorite && onToggleFavorite ? (
          <FavoriteButton
            active={favorite}
            onToggle={() => onToggleFavorite(item.sentenciaId ?? item.id)}
            disabled={favoritePending || !favoriteReady}
          />
        ) : null}
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
        {detailHref ? (
          <Link href={detailHref}>
            <Button variant="secondary">Ver sumario</Button>
          </Link>
        ) : null}
        {documentHref && hasPdf ? (
          <Link href={documentHref} onClick={() => void trackEvento({ tipoEvento: 'view_documento', metadata: { origen: 'consulta', slug: publicIdentifier } })}>
            <Button>Ver fallo</Button>
          </Link>
        ) : null}
        {documentHref && !hasPdf ? <Button variant="secondary" onClick={onMissingPdf}>PDF no disponible</Button> : null}
        {copyMessage ? <span role="status" className={styles.mutedText}>{copyMessage}</span> : null}
      </aside>
    </article>
  );
}

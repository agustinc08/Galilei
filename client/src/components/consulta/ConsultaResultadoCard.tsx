'use client';

import { Link } from "@/lib/router-compat";
import { useSearchParams } from '@/lib/router-compat';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { HighlightText } from './HighlightText';
import type { ConsultaPublicaResultado } from '@/types/busqueda';
import { trackEvento } from '@/lib/tracking';
import { formatDate } from '@/lib/utils';
import { formatTipoFallo } from '@/lib/jurisprudencia-labels';

type Props = {
  item: ConsultaPublicaResultado;
  selected: boolean;
  onToggle: (id: number) => void;
  onMissingPdf: () => void;
  query?: string;
};

export function ConsultaResultadoCard({
  item,
  selected,
  onToggle,
  onMissingPdf,
  query,
}: Props) {
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
      </aside>
    </article>
  );
}

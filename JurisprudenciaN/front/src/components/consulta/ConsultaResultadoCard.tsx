'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';
import { HighlightText } from './HighlightText';
import type { ConsultaPublicaResultado } from '@/types/busqueda';
import { trackEvento } from '@/lib/tracking';
import { formatDate } from '@/lib/utils';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api').replace(
  /\/api$/,
  '',
);

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
  const documentHref = publicIdentifier ? `/fallos/${publicIdentifier}?${detailQuery.toString()}` : null;

  return (
    <article
      className={`${styles.resultCard} ${selected ? styles.resultCardSelected : ''}`}
    >
      <div className={styles.resultMain}>
        <div className={styles.badges}>
          <span className={styles.badge}>
            {item.esFalloCorpus ? 'Fallo civil' : `N. Sumario: ${item.numeroSumario ?? `#${item.id}`}`}
          </span>
          {item.sala ? <span className={styles.badge}>Sala {item.sala}</span> : null}
          {item.tipoFallo ? <span className={styles.badge}>{item.tipoFallo}</span> : null}
          {hasPdf ? <span className={styles.badge}>PDF</span> : null}
        </div>

        <div className={styles.metaGrid}>
          <span>
            <strong>Sentencia:</strong> {item.numeroSentencia ?? '-'}
          </span>
          <span>
            <strong>Fecha:</strong> {formatDate(item.fecha)}
          </span>
          <span>
            <strong>Sala:</strong> {item.sala ?? '-'}
          </span>
          <span>
            <strong>Magistrados:</strong> {item.magistrados ?? '-'}
          </span>
          <span>
            <strong>Tipo:</strong> {item.tipoFallo ?? '-'}
          </span>
          <span>
            <strong>Tribunal:</strong> {item.tribunalOrigen ?? '-'}
          </span>
          <span>
            <strong>N° Expte:</strong> {item.expediente ?? '-'}
          </span>
          <span style={{ gridColumn: '1 / -1' }}>
            <strong>Expediente / Caratula:</strong> {item.caratula ?? '-'}
          </span>
        </div>

        <div className={styles.sumarioBox}>
          <strong className={styles.theme}>
            {item.esFalloCorpus ? 'Extracto del fallo' : `Tema: ${item.tema ?? 'Sin tema'}`}
          </strong>
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
          variant={selected ? 'primary' : 'secondary'}
          onClick={() => onToggle(item.id)}
        >
          {selected ? 'Seleccionado' : 'Seleccionar'}
        </Button>
        {publicIdentifier ? (
          <Link href={`/fallos/${publicIdentifier}?${detailQuery.toString()}`}>
            <Button variant="secondary">Detalle</Button>
          </Link>
        ) : null}
        {documentHref ? (
          <Link
            href={documentHref}
            onClick={() =>
              void trackEvento({
                tipoEvento: 'view_documento',
                metadata: { origen: 'consulta', slug: publicIdentifier },
              })
            }
          >
            <Button variant="secondary">Ver fallo</Button>
          </Link>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            if (hasPdf && item.pdfUrl) {
              const href = item.pdfUrl.startsWith('http')
                ? item.pdfUrl
                : `${API_BASE}${item.pdfUrl}`;
              void trackEvento({
                tipoEvento: 'download_pdf',
                metadata: { origen: 'consulta', slug: publicIdentifier },
              });
              window.open(href, '_blank', 'noopener');
              return;
            }
            onMissingPdf();
          }}
        >
          Fallo
        </Button>
      </aside>
    </article>
  );
}

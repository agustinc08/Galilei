'use client';

import { formatDateTime } from '@/lib/utils';
import styles from './documento.module.css';
import { DocumentoHighlight } from './DocumentoHighlight';

type Props = {
  resena?: string | null;
  publicada?: boolean;
  updatedAt?: string | null;
  publicView?: boolean;
  highlightQuery?: string;
};

export function DocumentoResenaSection({
  resena,
  publicada,
  updatedAt,
  publicView = false,
  highlightQuery,
}: Props) {
  if (!resena || (publicView && !publicada)) {
    return <div className={styles.empty}>Sin reseña publicada para este fallo.</div>;
  }

  return (
    <div className={styles.section}>
      {!publicView ? (
        <div className={styles.badgeRow}>
          <span
            className={`${styles.badge} ${
              publicada ? styles.badgeSuccess : styles.badgePending
            }`}
          >
            {publicada ? 'Publicada' : 'No publicada'}
          </span>
          {updatedAt ? (
            <span className={styles.badge}>Actualizada {formatDateTime(updatedAt)}</span>
          ) : null}
        </div>
      ) : null}
      <DocumentoHighlight
        text={resena}
        query={highlightQuery}
        className={styles.context}
      />
    </div>
  );
}

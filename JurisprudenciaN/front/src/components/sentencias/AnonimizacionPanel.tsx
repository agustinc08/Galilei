'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  anonimizado: boolean;
  actor?: string | null;
  demandado?: string | null;
  actorPublico?: string | null;
  demandadoPublico?: string | null;
  isSaving?: boolean;
  onAnonimizar: () => Promise<void> | void;
  onDesanonimizar: () => Promise<void> | void;
};

export function AnonimizacionPanel({
  anonimizado,
  actor,
  demandado,
  actorPublico,
  demandadoPublico,
  isSaving,
  onAnonimizar,
  onDesanonimizar,
}: Props) {
  return (
    <div className={styles.section}>
      <p className={styles.mutedText}>
        La vista publica usa siempre actorPublico y demandadoPublico cuando la sentencia esta anonimizada.
      </p>
      <div className={styles.summaryGrid}>
        <article className={styles.summaryItem}>
          <span>Actor interno</span>
          <strong>{actor ?? '-'}</strong>
        </article>
        <article className={styles.summaryItem}>
          <span>Actor publico</span>
          <strong>{actorPublico ?? '-'}</strong>
        </article>
        <article className={styles.summaryItem}>
          <span>Demandado interno</span>
          <strong>{demandado ?? '-'}</strong>
        </article>
        <article className={styles.summaryItem}>
          <span>Demandado publico</span>
          <strong>{demandadoPublico ?? '-'}</strong>
        </article>
      </div>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>
          {anonimizado ? 'Anonimizado' : 'No anonimizado'}
        </span>
      </div>
      <div className={styles.inlineActions}>
        <Button onClick={() => void onAnonimizar()} disabled={isSaving}>
          {isSaving ? 'Procesando...' : 'Anonimizar'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void onDesanonimizar()}
          disabled={isSaving}
        >
          Desanonimizar
        </Button>
      </div>
    </div>
  );
}

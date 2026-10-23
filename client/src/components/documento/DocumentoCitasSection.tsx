'use client';

import { CopyReferenceButton } from '@/components/sentencias/CopyReferenceButton';
import { Button } from '@/components/ui/Button';
import styles from './documento.module.css';
import type { CitaFallo } from '@/types/sentencia';

type Props = {
  citas: CitaFallo[];
  publicView?: boolean;
  onGoToPage?: (page: number) => void;
};

export function DocumentoCitasSection({
  citas,
  publicView = false,
  onGoToPage,
}: Props) {
  if (citas.length === 0) {
    return <div className={styles.empty}>Sin citas registradas.</div>;
  }

  return (
    <div className={styles.list}>
      {citas.map((cita) => (
        <article key={cita.id} className={styles.item}>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>{cita.tipo}</span>
            {!publicView ? (
              <span
                className={`${styles.badge} ${cita.confirmada ? '' : styles.badgePending}`}
              >
                {cita.confirmada ? 'Confirmada' : 'Pendiente'}
              </span>
            ) : null}
          </div>
          <strong>{cita.referencia}</strong>
          {cita.contexto ? <div className={styles.context}>{cita.contexto}</div> : null}
          <div className={styles.actions}>
            <CopyReferenceButton referencia={cita.referencia} />
            {cita.pagina ? (
              <Button
                variant="secondary"
                onClick={() => onGoToPage?.(cita.pagina!)}
                disabled={!onGoToPage}
              >
                Ver pág. {cita.pagina}
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

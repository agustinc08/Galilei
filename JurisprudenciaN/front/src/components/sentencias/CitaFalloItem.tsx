'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import type { CitaFallo } from '@/types/sentencia';
import { CopyReferenceButton } from './CopyReferenceButton';

type Props = {
  cita: CitaFallo;
  canDelete?: boolean;
  onToggleConfirm: (cita: CitaFallo) => void;
  onDelete: (id: number) => void;
};

export function CitaFalloItem({
  cita,
  canDelete,
  onToggleConfirm,
  onDelete,
}: Props) {
  return (
    <article className={styles.listItem}>
      <div className={styles.splitHeader}>
        <strong>
          {cita.tipo} | {cita.referencia}
        </strong>
        <div className={styles.inlineActions}>
          <CopyReferenceButton referencia={cita.referencia} />
          <Button variant="secondary" onClick={() => onToggleConfirm(cita)}>
            {cita.confirmada ? 'Marcar pendiente' : 'Confirmar'}
          </Button>
          {canDelete ? (
            <Button variant="secondary" onClick={() => onDelete(cita.id)}>
              Eliminar
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>
          {cita.confirmada ? 'Confirmada' : 'Pendiente de revision'}
        </span>
        <span className={styles.badge}>
          {cita.creadaManual ? 'Manual' : 'Detectada'}
        </span>
        {cita.pagina ? <span className={styles.badge}>Pág. {cita.pagina}</span> : null}
      </div>
      {cita.contexto ? <p>{cita.contexto}</p> : null}
    </article>
  );
}

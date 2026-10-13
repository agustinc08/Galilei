'use client';

import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SearchHelpModal({ open, onClose }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.toolbar}>
          <strong>Ayuda de búsqueda</strong>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <div className={styles.listGrid}>
          <div className={styles.listItem}>
            <strong>Frase exacta</strong>
            <span className={styles.mutedText}>&quot;daño moral&quot;</span>
          </div>
          <div className={styles.listItem}>
            <strong>Exclusión</strong>
            <span className={styles.mutedText}>daño -penal</span>
          </div>
          <div className={styles.listItem}>
            <strong>OR</strong>
            <span className={styles.mutedText}>mala praxis OR responsabilidad médica</span>
          </div>
          <div className={styles.listItem}>
            <strong>Campos</strong>
            <span className={styles.mutedText}>
              tema:&quot;daño moral&quot; sala:C expediente:&quot;123/2024&quot;
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

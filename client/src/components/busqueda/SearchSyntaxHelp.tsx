'use client';

import { useState } from 'react';
import styles from '@/components/consulta/consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  compact?: boolean;
};

export function SearchSyntaxHelp({ compact = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={styles.toolbarRight}>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Ayuda de búsqueda
        </Button>
      </div>
      {open ? (
        <dialog
          open
          className={styles.modalOverlay}
          aria-modal="true"
          aria-labelledby="search-syntax-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div className={styles.modal}>
            <div className={styles.toolbar}>
              <strong id="search-syntax-title">Sintaxis de búsqueda</strong>
              <Button variant="secondary" onClick={() => setOpen(false)}>
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
              {!compact ? (
                <div className={styles.listItem}>
                  <strong>Campos</strong>
                  <span className={styles.mutedText}>
                    tema:&quot;daño moral&quot; sala:C expediente:&quot;123/2024&quot;
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}

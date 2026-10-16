'use client';

import { useEffect, useRef } from 'react';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SearchHelpModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current
      ?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled])')
      ?.focus();

    return () => returnFocusRef.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          return;
        }

        if (event.key !== 'Tab') return;

        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.toolbar}>
          <strong id="search-help-title">Ayuda de búsqueda</strong>
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

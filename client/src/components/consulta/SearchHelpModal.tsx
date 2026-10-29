'use client';

import { useEffect, useRef } from 'react';
import styles from './consulta.module.css';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SearchHelpModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    <dialog
      open
      ref={dialogRef}
      className={styles.modalOverlay}
      aria-modal="true"
      aria-labelledby="search-help-title"
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
      <div className={styles.modal}>
        <div className={styles.toolbar}>
          <strong id="search-help-title">Ayuda de búsqueda</strong>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
          <div className={`${styles.listGrid} ${styles.searchHelpList}`}>
          <details className={styles.listItem}>
            <summary>Términos sin comillas</summary>
            <span className={styles.mutedText}>responsabilidad civil — busca desde el inicio de cada palabra; por defecto deben coincidir todos los términos.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Una palabra exacta</summary>
            <span className={styles.mutedText}>&quot;daño&quot; — encuentra la palabra completa, no un fragmento dentro de otra palabra.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Frase exacta</summary>
            <span className={styles.mutedText}>&quot;daño moral&quot; — respeta el orden y no intercala otras palabras.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Exclusión</summary>
            <span className={styles.mutedText}>daño -penal</span>
          </details>
          <details className={styles.listItem}>
            <summary>Operadores</summary>
            <span className={styles.mutedText}>OR o + admite cualquiera; AND exige ambos. El selector «Coincidencia» aplica a términos sin operador explícito.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Campos</summary>
            <span className={styles.mutedText}>tema:&quot;daño moral&quot; sala:C expediente:&quot;123/2024&quot;</span>
          </details>
          <details className={styles.listItem}>
            <summary>Comodín %</summary>
            <span className={styles.mutedText}>responsabilidad% busca palabras que comienzan así; %civil busca las que terminan así; %civil% busca ese fragmento en cualquier posición.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Acentos y ñ</summary>
            <span className={styles.mutedText}>Las mayúsculas y tildes no cambian la búsqueda; ñ se considera distinta de n.</span>
          </details>
          <details className={styles.listItem}>
            <summary>Filtros</summary>
            <span className={styles.mutedText}>Combiná texto con Sala, fecha, tribunal, expediente, carátula, tipo de fallo, PDF y otros campos disponibles en el formulario.</span>
          </details>
        </div>
      </div>
    </dialog>
  );
}

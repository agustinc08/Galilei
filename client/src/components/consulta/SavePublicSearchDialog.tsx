'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from './consulta.module.css';

type Props = {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
};

export function SavePublicSearchDialog({ open, saving, onClose, onSave }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => returnFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      open
      ref={dialogRef}
      className={styles.modalOverlay}
      aria-modal="true"
      aria-labelledby="save-public-search-title"
      aria-describedby="save-public-search-description"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !saving) {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
      <form
        className={styles.modal}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !saving) void onSave(name.trim());
        }}
      >
        <div className={styles.toolbar}>
          <strong id="save-public-search-title">Guardar búsqueda pública</strong>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cerrar</Button>
        </div>
        <p id="save-public-search-description">Se guardan el texto, los filtros, el orden y la página actual en tu cuenta. No se guardan resultados ni copias de documentos.</p>
        <Input
          label="Nombre de la búsqueda"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={150}
          required
          autoComplete="off"
        />
        <div className={styles.toolbar}>
          <span />
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Guardando…' : 'Guardar búsqueda'}</Button>
        </div>
      </form>
    </dialog>
  );
}

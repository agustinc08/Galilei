'use client';

import styles from './wizard.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ArchivoPdf } from '@/types/archivo';

type Props = {
  draftId: number | null;
  file: File | null;
  archivos: ArchivoPdf[];
  onFileChange: (file: File | null) => void;
};

export function PdfStep({ draftId, file, archivos, onFileChange }: Props) {
  return (
    <div className={styles.stepCard}>
      <p className={styles.helper}>
        El borrador se crea al cerrar el paso 1. Puedes subir un PDF ahora o
        continuar sin PDF y cargarlo más adelante desde el detalle de la sentencia.
      </p>
      <div className={styles.fileRow}>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <Button variant="secondary" onClick={() => onFileChange(null)}>
              Quitar selección
            </Button>
          </>
        ) : null}
      </div>

      {!draftId ? (
        <EmptyState
          title="Primero guarda los datos basicos"
          description="El borrador se crea al avanzar desde el paso 1."
        />
      ) : null}

      {archivos.length > 0 ? (
        <div className={styles.list}>
          {archivos.map((archivo) => (
            <article key={archivo.id} className={styles.listItem}>
              <strong>{archivo.nombreOriginal ?? archivo.nombreArchivo}</strong>
              <span className={styles.helper}>PDF ya asociado al borrador.</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sin PDF cargado"
          description="Si seleccionas un archivo, se subirá al avanzar al paso de sumarios."
        />
      )}
    </div>
  );
}

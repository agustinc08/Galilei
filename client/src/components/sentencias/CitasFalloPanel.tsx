'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { CitaFallo } from '@/types/sentencia';
import { CitaFalloForm } from './CitaFalloForm';
import { CitaFalloItem } from './CitaFalloItem';

type FormValues = {
  tipo: string;
  referencia: string;
  contexto: string;
  pagina: string;
};

type Props = {
  citas: CitaFallo[];
  formValues: FormValues;
  isSaving?: boolean;
  canDelete?: boolean;
  onDetect: () => void;
  onFormChange: (values: FormValues) => void;
  onCreateManual: () => void;
  onToggleConfirm: (cita: CitaFallo) => void;
  onDelete: (id: number) => void;
};

export function CitasFalloPanel({
  citas,
  formValues,
  isSaving,
  canDelete,
  onDetect,
  onFormChange,
  onCreateManual,
  onToggleConfirm,
  onDelete,
}: Props) {
  return (
    <div className={styles.section}>
      <p className={styles.mutedText}>
        La deteccion automatica identifica referencias frecuentes como Fallos,
        CSJ, CAF, CIV, expedientes y salas. Revise y confirme las citas antes de
        publicarlas.
      </p>
      <div className={styles.inlineActions}>
        <Button variant="secondary" onClick={onDetect} disabled={isSaving}>
          {isSaving ? 'Detectando...' : 'Detectar citas'}
        </Button>
      </div>

      <CitaFalloForm
        values={formValues}
        isSaving={isSaving}
        onChange={onFormChange}
        onSubmit={onCreateManual}
      />

      {citas.length === 0 ? (
        <EmptyState
          title="Sin citas detectadas"
          description="Puedes detectarlas automaticamente o cargarlas manualmente."
        />
      ) : (
        <div className={styles.listGrid}>
          {citas.map((cita) => (
            <CitaFalloItem
              key={cita.id}
              cita={cita}
              canDelete={canDelete}
              onToggleConfirm={onToggleConfirm}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { formatDate } from '@/lib/utils';

type Props = {
  value: string;
  isSaving?: boolean;
  publicada: boolean;
  updatedAt?: string | null;
  publicadaAt?: string | null;
  sugeridaIa?: string | null;
  isGeneratingIa?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onTogglePublicacion: () => void;
  onGenerateIa?: () => void;
};

export function ResenaEditor({
  value,
  isSaving,
  publicada,
  updatedAt,
  publicadaAt,
  sugeridaIa,
  isGeneratingIa,
  onChange,
  onSave,
  onTogglePublicacion,
  onGenerateIa,
}: Props) {
  return (
    <div className={styles.section}>
      <p className={styles.mutedText}>
        La reseña pública debe ser revisada antes de publicarse. Puede incorporarse un borrador editable, siempre sujeto a revisión manual.
      </p>
      <div className={styles.inlineActions}>
        <Button
          variant="secondary"
          onClick={onGenerateIa}
          disabled={!onGenerateIa || isGeneratingIa}
        >
          {isGeneratingIa ? 'Generando borrador...' : 'Generar borrador de reseña'}
        </Button>
        {sugeridaIa ? (
          <Button variant="secondary" onClick={() => onChange(sugeridaIa)}>
            Usar sugerencia
          </Button>
        ) : null}
      </div>
      {sugeridaIa ? (
        <div className={styles.listItem}>
          <strong>Borrador de reseña</strong>
          <p className={styles.mutedText}>{sugeridaIa}</p>
        </div>
      ) : null}
      <Textarea
        label="Reseña editorial"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.inlineActions}>
        <Button variant="secondary" onClick={onTogglePublicacion}>
          {publicada ? 'Despublicar reseña' : 'Publicar reseña'}
        </Button>
        <Button onClick={onSave} disabled={isSaving}>
          {isSaving ? 'Guardando...' : 'Guardar reseña'}
        </Button>
      </div>
      <div className={styles.badgeRow}>
        <span className={styles.badge}>
          {publicada ? 'Publicada' : 'No publicada'}
        </span>
        {updatedAt ? (
          <span className={styles.badge}>Actualizada: {formatDate(updatedAt)}</span>
        ) : null}
        {publicadaAt ? (
          <span className={styles.badge}>Publicada: {formatDate(publicadaAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import styles from './wizard.module.css';
import baseStyles from './sentencias.module.css';
import { Checkbox } from '@/components/ui/Checkbox';
import { Textarea } from '@/components/ui/Textarea';

type Props = {
  value: string;
  publicar: boolean;
  onChange: (value: string) => void;
  onTogglePublicar: (value: boolean) => void;
};

export function ResenaStep({
  value,
  publicar,
  onChange,
  onTogglePublicar,
}: Props) {
  return (
    <div className={baseStyles.section}>
      <p className={styles.helper}>
        La reseña será visible en la consulta pública solo si se publica.
      </p>
      <Textarea
        label="Reseña editorial"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={baseStyles.checkboxGrid}>
        <Checkbox
          label="Publicar reseña"
          checked={publicar}
          onChange={(event) => onTogglePublicar(event.target.checked)}
        />
      </div>
    </div>
  );
}

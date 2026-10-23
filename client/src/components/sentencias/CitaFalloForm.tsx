'use client';

import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

type FormValues = {
  tipo: string;
  referencia: string;
  contexto: string;
  pagina: string;
};

type Props = {
  values: FormValues;
  isSaving?: boolean;
  onChange: (values: FormValues) => void;
  onSubmit: () => void;
};

export function CitaFalloForm({ values, isSaving, onChange, onSubmit }: Props) {
  return (
    <div className={styles.section}>
      <div className={styles.formGrid}>
        <Input
          label="Tipo"
          value={values.tipo}
          onChange={(event) => onChange({ ...values, tipo: event.target.value })}
        />
        <Input
          label="Referencia"
          value={values.referencia}
          onChange={(event) =>
            onChange({ ...values, referencia: event.target.value })
          }
        />
        <Input
          label="Página"
          value={values.pagina}
          onChange={(event) => onChange({ ...values, pagina: event.target.value })}
        />
        <Textarea
          label="Contexto"
          value={values.contexto}
          onChange={(event) =>
            onChange({ ...values, contexto: event.target.value })
          }
        />
      </div>
      <div className={styles.inlineActions}>
        <Button onClick={onSubmit} disabled={isSaving}>
          Agregar cita manual
        </Button>
      </div>
    </div>
  );
}

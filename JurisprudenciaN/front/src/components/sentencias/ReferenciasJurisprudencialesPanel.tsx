'use client';

import { useState } from 'react';
import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { CopyReferenceButton } from './CopyReferenceButton';
import type { ReferenciaJurisprudencial } from '@/types/sentencia';

type FormValues = {
  referencia: string;
  textoOriginal: string;
  falloRelacionadoId: string;
};

type Props = {
  referencias: ReferenciaJurisprudencial[];
  isSaving?: boolean;
  onCreate: (values: FormValues) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
};

const initialValues: FormValues = {
  referencia: '',
  textoOriginal: '',
  falloRelacionadoId: '',
};

export function ReferenciasJurisprudencialesPanel({
  referencias,
  isSaving,
  onCreate,
  onDelete,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialValues);

  const updateField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = async () => {
    if (!values.referencia.trim()) {
      return;
    }

    await onCreate(values);
    setValues(initialValues);
  };

  return (
    <div className={styles.section}>
      <div className={styles.formGrid}>
        <Input
          label="Referencia"
          value={values.referencia}
          onChange={(event) => updateField('referencia', event.target.value)}
          placeholder="Fallos 342:533"
        />
        <Input
          label="ID sentencia relacionada"
          value={values.falloRelacionadoId}
          onChange={(event) => updateField('falloRelacionadoId', event.target.value)}
          placeholder="Opcional"
        />
        <Input
          label="Texto original"
          value={values.textoOriginal}
          onChange={(event) => updateField('textoOriginal', event.target.value)}
          placeholder="Opcional"
        />
      </div>
      <div className={styles.inlineActions}>
        <Button onClick={() => void handleCreate()} disabled={isSaving}>
          {isSaving ? 'Guardando...' : 'Agregar referencia'}
        </Button>
      </div>

      {referencias.length === 0 ? (
        <EmptyState
          title="Sin jurisprudencia relacionada"
          description="Carga otros fallos citados o vinculados."
        />
      ) : (
        <div className={styles.listGrid}>
          {referencias.map((referencia) => (
            <article key={referencia.id} className={styles.listItem}>
              <strong>{referencia.referencia}</strong>
              {referencia.textoOriginal ? <p>{referencia.textoOriginal}</p> : null}
              {referencia.falloRelacionado ? (
                <p className={styles.mutedText}>
                  Vinculado a sentencia #{referencia.falloRelacionado.id}
                  {referencia.falloRelacionado.numeroSentencia
                    ? ` - ${referencia.falloRelacionado.numeroSentencia}`
                    : ''}
                </p>
              ) : null}
              <div className={styles.inlineActions}>
                <CopyReferenceButton referencia={referencia.referencia} />
                <Button
                  variant="danger"
                  onClick={() => void onDelete(referencia.id)}
                  disabled={isSaving}
                >
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

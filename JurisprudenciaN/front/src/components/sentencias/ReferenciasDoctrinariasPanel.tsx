'use client';

import { useState } from 'react';
import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { ReferenciaDoctrinaria } from '@/types/sentencia';

type FormValues = {
  autor: string;
  titulo: string;
  fuente: string;
  anio: string;
  textoReferencia: string;
  url: string;
};

type Props = {
  referencias: ReferenciaDoctrinaria[];
  isSaving?: boolean;
  onCreate: (values: FormValues) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
};

const initialValues: FormValues = {
  autor: '',
  titulo: '',
  fuente: '',
  anio: '',
  textoReferencia: '',
  url: '',
};

export function ReferenciasDoctrinariasPanel({
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
    if (!values.autor.trim() && !values.titulo.trim() && !values.textoReferencia.trim()) {
      return;
    }

    await onCreate(values);
    setValues(initialValues);
  };

  return (
    <div className={styles.section}>
      <div className={styles.formGrid}>
        <Input
          label="Autor"
          value={values.autor}
          onChange={(event) => updateField('autor', event.target.value)}
        />
        <Input
          label="Titulo"
          value={values.titulo}
          onChange={(event) => updateField('titulo', event.target.value)}
        />
        <Input
          label="Fuente"
          value={values.fuente}
          onChange={(event) => updateField('fuente', event.target.value)}
        />
        <Input
          label="Año"
          type="number"
          value={values.anio}
          onChange={(event) => updateField('anio', event.target.value)}
        />
        <Input
          label="URL"
          value={values.url}
          onChange={(event) => updateField('url', event.target.value)}
          placeholder="https://..."
        />
      </div>
      <Textarea
        label="Texto de referencia"
        value={values.textoReferencia}
        onChange={(event) => updateField('textoReferencia', event.target.value)}
      />
      <div className={styles.inlineActions}>
        <Button onClick={() => void handleCreate()} disabled={isSaving}>
          {isSaving ? 'Guardando...' : 'Agregar referencia'}
        </Button>
      </div>

      {referencias.length === 0 ? (
        <EmptyState
          title="Sin doctrina relacionada"
          description="Carga autores, obras o articulos doctrinarios vinculados."
        />
      ) : (
        <div className={styles.listGrid}>
          {referencias.map((referencia) => (
            <article key={referencia.id} className={styles.listItem}>
              <strong>{[referencia.autor, referencia.titulo].filter(Boolean).join(' - ') || 'Referencia doctrinaria'}</strong>
              <p>{[referencia.fuente, referencia.anio].filter(Boolean).join(' | ')}</p>
              {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
              <div className={styles.inlineActions}>
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

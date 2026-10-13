'use client';

import { useState } from 'react';
import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { ReferenciaNormativa } from '@/types/sentencia';

type FormValues = {
  normaArticuloId: string;
  tipoNorma: string;
  numeroNorma: string;
  articulo: string;
  inciso: string;
  textoReferencia: string;
  url: string;
};

type Props = {
  referencias: ReferenciaNormativa[];
  isSaving?: boolean;
  isDetecting?: boolean;
  onCreate: (values: FormValues) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onDetect?: () => Promise<void> | void;
};

const initialValues: FormValues = {
  normaArticuloId: '',
  tipoNorma: '',
  numeroNorma: '',
  articulo: '',
  inciso: '',
  textoReferencia: '',
  url: '',
};

export function ReferenciasNormativasPanel({
  referencias,
  isSaving,
  isDetecting,
  onCreate,
  onDelete,
  onDetect,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialValues);

  const updateField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = async () => {
    if (!values.normaArticuloId.trim() && !values.tipoNorma.trim()) {
      return;
    }

    await onCreate(values);
    setValues(initialValues);
  };

  return (
    <div className={styles.section}>
      <p className={styles.mutedText}>
        Puedes vincular una norma cargada por ID o completar la referencia manualmente.
      </p>
      <div className={styles.inlineActions}>
        <Button
          variant="secondary"
          onClick={onDetect}
          disabled={!onDetect || isSaving || isDetecting}
        >
          {isDetecting ? 'Detectando normas...' : 'Detectar normas automáticamente'}
        </Button>
      </div>
      <div className={styles.formGrid}>
        <Input
          label="Norma cargada (ID)"
          value={values.normaArticuloId}
          onChange={(event) => updateField('normaArticuloId', event.target.value)}
          placeholder="Opcional"
        />
        <Input
          label="Tipo de norma"
          value={values.tipoNorma}
          onChange={(event) => updateField('tipoNorma', event.target.value)}
          placeholder="CCyC, CPCCN, ley"
        />
        <Input
          label="Número"
          value={values.numeroNorma}
          onChange={(event) => updateField('numeroNorma', event.target.value)}
        />
        <Input
          label="Artículo"
          value={values.articulo}
          onChange={(event) => updateField('articulo', event.target.value)}
        />
        <Input
          label="Inciso"
          value={values.inciso}
          onChange={(event) => updateField('inciso', event.target.value)}
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
          title="Sin normas relacionadas"
          description="Carga artículos o normas relacionadas con este fallo."
        />
      ) : (
        <div className={styles.listGrid}>
          {referencias.map((referencia) => (
            <article key={referencia.id} className={styles.listItem}>
              <strong>
                {referencia.tipoNorma}
                {referencia.numeroNorma ? ` ${referencia.numeroNorma}` : ''}
                {referencia.articulo ? ` art. ${referencia.articulo}` : ''}
                {referencia.inciso ? ` inc. ${referencia.inciso}` : ''}
              </strong>
              {referencia.textoReferencia ? <p>{referencia.textoReferencia}</p> : null}
              <div className={styles.inlineActions}>
                {referencia.url ? (
                  <a href={referencia.url} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Abrir norma</Button>
                  </a>
                ) : null}
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

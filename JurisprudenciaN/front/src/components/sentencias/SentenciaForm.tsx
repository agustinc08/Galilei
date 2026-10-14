'use client';

import { useState } from 'react';
import styles from './sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';
import type { CatalogoItem } from '@/types/catalogos';
import type { SentenciaFormValues } from '@/types/sentencia';

type SentenciaFormProps = {
  initialValues: SentenciaFormValues;
  submitLabel: string;
  onSubmit: (values: SentenciaFormValues) => Promise<void>;
  salas?: CatalogoItem[];
  tiposFallo?: CatalogoItem[];
  tribunalesOrigen?: CatalogoItem[];
};

export function SentenciaForm({
  initialValues,
  submitLabel,
  onSubmit,
  salas = [],
  tiposFallo = [],
  tribunalesOrigen = [],
}: SentenciaFormProps) {
  const [values, setValues] = useState<SentenciaFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const update = <K extends keyof SentenciaFormValues>(
    key: K,
    value: SentenciaFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      await onSubmit(values);
      setSuccess('Cambios guardados correctamente.');
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : 'No se pudo guardar la sentencia.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className={styles.section} onSubmit={handleSubmit}>
      {error ? <StatusMessage variant="error" title="No se pudo guardar" message={error} /> : null}
      {success ? (
        <StatusMessage variant="success" title="Sentencia guardada" message={success} />
      ) : null}

      <div className={styles.formGrid}>
        <Input
          label="N° de sentencia"
          value={values.numeroSentencia}
          onChange={(event) => update('numeroSentencia', event.target.value)}
        />
        {tiposFallo.length > 0 ? (
          <Select
            label="Tipo de fallo"
            value={String(values.tipoFalloId || '')}
            options={[
              { label: 'Seleccionar tipo', value: '' },
              ...tiposFallo.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = tiposFallo.find((item) => item.id === Number(event.target.value));
              update('tipoFalloId', event.target.value ? Number(event.target.value) : '');
              update('tipoFallo', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input
            label="Tipo de fallo"
            value={values.tipoFallo}
            onChange={(event) => update('tipoFallo', event.target.value)}
          />
        )}
        {salas.length > 0 ? (
          <Select
            label="Sala"
            value={String(values.salaId || '')}
            options={[
              { label: 'Seleccionar sala', value: '' },
              ...salas.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = salas.find((item) => item.id === Number(event.target.value));
              update('salaId', event.target.value ? Number(event.target.value) : '');
              update('sala', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input label="Sala" value={values.sala} onChange={(event) => update('sala', event.target.value)} />
        )}
        <Input label="Fecha" type="date" value={values.fecha} onChange={(event) => update('fecha', event.target.value)} />
        <Input label="Expediente" value={values.expediente} onChange={(event) => update('expediente', event.target.value)} />
        {tribunalesOrigen.length > 0 ? (
          <Select
            label="Tribunal de origen"
            value={String(values.tribunalOrigenId || '')}
            options={[
              { label: 'Seleccionar tribunal', value: '' },
              ...tribunalesOrigen.map((item) => ({ label: item.nombre, value: String(item.id) })),
            ]}
            onChange={(event) => {
              const selected = tribunalesOrigen.find((item) => item.id === Number(event.target.value));
              update('tribunalOrigenId', event.target.value ? Number(event.target.value) : '');
              update('tribunalOrigen', selected?.nombre ?? '');
            }}
          />
        ) : (
          <Input
            label="Tribunal de origen"
            value={values.tribunalOrigen}
            onChange={(event) => update('tribunalOrigen', event.target.value)}
          />
        )}
        <Input label="Caratula" value={values.caratula} onChange={(event) => update('caratula', event.target.value)} />
        <Input label="Actor" value={values.actor} onChange={(event) => update('actor', event.target.value)} />
        <Input label="Demandado" value={values.demandado} onChange={(event) => update('demandado', event.target.value)} />
        <Input label="Objeto" value={values.objeto} onChange={(event) => update('objeto', event.target.value)} />
        <Input label="Magistrados" value={values.magistrados} onChange={(event) => update('magistrados', event.target.value)} />
        <Input label="Juez" value={values.juez} onChange={(event) => update('juez', event.target.value)} />
      </div>

      <Textarea
        label="Observaciones internas"
        value={values.observacionesInternas}
        onChange={(event) => update('observacionesInternas', event.target.value)}
      />

      <p role="note">Los cambios se guardan como borrador. La publicación y el archivo se gestionan con acciones explícitas.</p>

      <div className={styles.inlineActions}>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Guardando...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

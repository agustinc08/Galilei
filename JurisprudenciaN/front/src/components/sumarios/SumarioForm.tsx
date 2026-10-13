'use client';

import { useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';
import type { SumarioFormValues } from '@/types/sumario';

type SumarioFormProps = {
  initialValues: SumarioFormValues;
  submitLabel: string;
  onSubmit: (values: SumarioFormValues) => Promise<void>;
  onCancel?: () => void;
};

export function SumarioForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: SumarioFormProps) {
  const [values, setValues] = useState<SumarioFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const update = <K extends keyof SumarioFormValues>(key: K, value: SumarioFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!values.sentenciaId || Number(values.sentenciaId) <= 0) {
      setError('Ingresa una sentencia valida.');
      return;
    }

    if (!values.texto.trim()) {
      setError('El texto del sumario es obligatorio.');
      return;
    }

    setIsSaving(true);

    try {
      await onSubmit(values);
      setSuccess('Sumario guardado correctamente.');
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'No se pudo guardar el sumario.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className={styles.section} onSubmit={handleSubmit}>
      {error ? <StatusMessage variant="error" title="No se pudo guardar" message={error} /> : null}
      {success ? <StatusMessage variant="success" title="Sumario guardado" message={success} /> : null}

      <div className={styles.formGrid}>
        <Input
          label="ID sentencia"
          type="number"
          min={1}
          value={values.sentenciaId}
          onChange={(event) =>
            update('sentenciaId', event.target.value ? Number(event.target.value) : '')
          }
        />
        <Input
          label="N° de sumario"
          value={values.numeroSumario}
          onChange={(event) => update('numeroSumario', event.target.value)}
        />
        <Input label="Tema" value={values.tema} onChange={(event) => update('tema', event.target.value)} />
      </div>

      <Textarea label="Texto" value={values.texto} onChange={(event) => update('texto', event.target.value)} />
      <Textarea
        label="Resumen de búsqueda"
        value={values.resumenBusqueda}
        onChange={(event) => update('resumenBusqueda', event.target.value)}
      />

      <div className={styles.checkboxGrid}>
        <Checkbox
          label="Publicado"
          checked={values.publicado}
          onChange={(event) => update('publicado', event.target.checked)}
        />
        <Checkbox
          label="Activo"
          checked={values.activo}
          onChange={(event) => update('activo', event.target.checked)}
        />
      </div>

      <div className={styles.inlineActions}>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Guardando...' : submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

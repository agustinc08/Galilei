'use client';

import { useState } from 'react';
import styles from './sentencias.module.css';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Textarea } from '@/components/ui/Textarea';

type BatchItem = {
  numeroSumario: string;
  tema: string;
  texto: string;
};

type Props = {
  sentenciaId: number;
  onSubmitted: () => Promise<void> | void;
};

export function BatchSumariosForm({ sentenciaId, onSubmitted }: Props) {
  const [rawValue, setRawValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parseLines = (): BatchItem[] =>
    rawValue
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [numeroSumario = '', tema = '', texto = ''] = line.split('|');
        return {
          numeroSumario: numeroSumario.trim(),
          tema: tema.trim(),
          texto: texto.trim(),
        };
      })
      .filter((item) => item.texto.length > 0);

  const handleSubmit = async () => {
    const sumarios = parseLines();
    if (!sumarios.length) {
      setError('Ingresá al menos un sumario con texto.');
      return;
    }

    setError(null);
    setFeedback(null);
    setIsSubmitting(true);

    try {
      await api.post(`/sentencias/${sentenciaId}/sumarios/lote`, { sumarios });
      setRawValue('');
      setFeedback(`Se cargaron ${sumarios.length} sumarios.`);
      await onSubmitted();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'No se pudieron cargar los sumarios.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.section}>
      {feedback ? <StatusMessage variant="success" title="Carga realizada" message={feedback} /> : null}
      {error ? <StatusMessage variant="error" title="Carga fallida" message={error} /> : null}
      <Textarea
        label="Lote de sumarios"
        placeholder="numeroSumario | tema | texto"
        value={rawValue}
        onChange={(event) => setRawValue(event.target.value)}
      />
      <div className={styles.inlineActions}>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Cargando...' : 'Agregar sumarios por lote'}
        </Button>
      </div>
    </div>
  );
}

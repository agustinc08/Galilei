'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

type Props = { sentenciaId: number };
type CitationResponse = { citaCopiable?: string | null };

export function CopySentenceCitationButton({ sentenciaId }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied' | 'failed'>('idle');

  const copyCitation = async () => {
    if (state === 'loading') return;
    setState('loading');
    try {
      const response = await api.get<{ data: CitationResponse }>(
        `/sentencias/${sentenciaId}/cita`,
      );
      const citation = response.data.citaCopiable?.trim();
      if (!citation) {
        setState('failed');
        return;
      }
      setState((await copyToClipboard(citation)) ? 'copied' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <Button variant="secondary" onClick={() => void copyCitation()} disabled={state === 'loading'}>
      {state === 'loading'
        ? 'Preparando cita…'
        : state === 'copied'
          ? 'Cita copiada'
          : state === 'failed'
            ? 'No se pudo copiar'
            : 'Copiar cita'}
    </Button>
  );
}

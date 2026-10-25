'use client';

import { useState } from 'react';
import { trackEvento } from '@/lib/tracking';
import { copyToClipboard } from '@/lib/utils';
import { Button } from './Button';

type Props = {
  url: string;
  label?: string;
  sentenciaId?: number;
};

export function ShareLinkButton({
  url,
  label = 'Copiar enlace',
  sentenciaId,
}: Props) {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        const copied = await copyToClipboard(url);
        if (copied) {
          void trackEvento({
            tipoEvento: 'share_link',
            sentenciaId,
            metadata: { origen: 'ficha-publica' },
          });
        }
        setStatus(copied ? 'copied' : 'failed');
        window.setTimeout(() => setStatus(null), 2000);
      }}
    >
      {status === 'copied' ? 'Enlace copiado' : status === 'failed' ? 'No se pudo copiar' : label}
    </Button>
  );
}

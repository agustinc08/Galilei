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
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await copyToClipboard(url);
        void trackEvento({
          tipoEvento: 'share_link',
          sentenciaId,
          metadata: { url },
        });
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Enlace copiado' : label}
    </Button>
  );
}

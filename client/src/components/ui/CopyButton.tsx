'use client';

import { useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { Button } from './Button';

type Props = {
  value: string;
  label?: string;
};

export function CopyButton({ value, label = 'Copiar' }: Props) {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        const copied = await copyToClipboard(value);
        setStatus(copied ? 'copied' : 'failed');
        window.setTimeout(() => setStatus(null), 2000);
      }}
    >
      {status === 'copied' ? 'Copiado' : status === 'failed' ? 'No se pudo copiar' : label}
    </Button>
  );
}

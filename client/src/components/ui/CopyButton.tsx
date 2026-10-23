'use client';

import { useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import { Button } from './Button';

type Props = {
  value: string;
  label?: string;
};

export function CopyButton({ value, label = 'Copiar' }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await copyToClipboard(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copiado' : label}
    </Button>
  );
}

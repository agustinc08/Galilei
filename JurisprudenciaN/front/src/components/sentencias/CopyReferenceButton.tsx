'use client';

import { CopyButton } from '@/components/ui/CopyButton';

type Props = {
  referencia: string;
};

export function CopyReferenceButton({ referencia }: Props) {
  return <CopyButton value={referencia} label="Copiar referencia" />;
}

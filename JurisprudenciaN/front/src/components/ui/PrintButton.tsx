'use client';

import { Button } from './Button';

type Props = {
  onPrint: () => void;
};

export function PrintButton({ onPrint }: Props) {
  return (
    <Button variant="secondary" onClick={onPrint}>
      Imprimir ficha
    </Button>
  );
}

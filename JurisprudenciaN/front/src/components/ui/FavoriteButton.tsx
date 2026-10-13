'use client';

import { Button } from './Button';

type Props = {
  active: boolean;
  onToggle: () => void | Promise<void>;
  disabled?: boolean;
};

export function FavoriteButton({ active, onToggle, disabled }: Props) {
  return (
    <Button variant={active ? 'primary' : 'secondary'} onClick={onToggle} disabled={disabled}>
      {active ? 'Quitar favorito' : 'Guardar favorito'}
    </Button>
  );
}

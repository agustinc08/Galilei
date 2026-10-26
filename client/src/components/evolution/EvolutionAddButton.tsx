'use client';

import { Button } from '@/components/ui/Button';
import { useEvolutionSelection } from './EvolutionSelection';

export function EvolutionAddButton({ slug, title, variant = 'ghost' }: {
  slug: string;
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const selection = useEvolutionSelection();
  const selected = selection.items.some((item) => item.slug === slug);
  return (
    <Button
      variant={selected ? 'secondary' : variant}
      aria-pressed={selected}
      onClick={() => selection.toggle({ slug, title })}
    >
      {selected ? 'Quitar de evolución' : 'Añadir a evolución'}
    </Button>
  );
}

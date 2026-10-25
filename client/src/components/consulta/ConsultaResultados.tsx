'use client';

import styles from './consulta.module.css';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConsultaResultadoCard } from './ConsultaResultadoCard';
import type { ConsultaPublicaResultado } from '@/types/busqueda';

type Props = {
  data: ConsultaPublicaResultado[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onMissingPdf: () => void;
  query?: string;
  canFavorite?: boolean;
  favoriteIds?: ReadonlySet<number>;
  favoriteReady?: boolean;
  favoritePendingIds?: ReadonlySet<number>;
  onToggleFavorite?: (id: number) => void | Promise<void>;
  canAddToCollection?: boolean;
};

export function ConsultaResultados({
  data,
  selectedIds,
  onToggle,
  onMissingPdf,
  query,
  canFavorite,
  favoriteIds = new Set<number>(),
  favoriteReady = true,
  favoritePendingIds = new Set<number>(),
  onToggleFavorite,
  canAddToCollection = false,
}: Props) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="Sin resultados"
        description="No se encontraron sumarios publicados con los filtros actuales."
      />
    );
  }

  return (
    <div className={styles.resultList}>
      {data.map((item) => (
        <ConsultaResultadoCard
          key={item.id}
          item={item}
          selected={selectedIds.includes(item.id)}
          onToggle={onToggle}
          onMissingPdf={onMissingPdf}
          query={query}
          canFavorite={canFavorite}
          favorite={favoriteIds.has(item.sentenciaId ?? item.id)}
          favoriteReady={favoriteReady}
          favoritePending={favoritePendingIds.has(item.sentenciaId ?? item.id)}
          onToggleFavorite={onToggleFavorite}
          canAddToCollection={canAddToCollection}
        />
      ))}
    </div>
  );
}

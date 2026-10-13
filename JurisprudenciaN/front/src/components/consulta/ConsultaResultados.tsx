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
};

export function ConsultaResultados({
  data,
  selectedIds,
  onToggle,
  onMissingPdf,
  query,
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
        />
      ))}
    </div>
  );
}

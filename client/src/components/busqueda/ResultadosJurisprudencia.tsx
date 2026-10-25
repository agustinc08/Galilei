'use client';

import { BusquedaResultados } from './BusquedaResultados';
import { ConsultaResultados } from '@/components/consulta/ConsultaResultados';
import type { BusquedaResultado, ConsultaPublicaResultado } from '@/types/busqueda';

type PublicProps = {
  modo: 'publico';
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
};

type AdminProps = {
  modo: 'admin';
  data: BusquedaResultado[];
  query?: string;
};

type Props = PublicProps | AdminProps;

export function ResultadosJurisprudencia(props: Props) {
  if (props.modo === 'publico') {
    return (
      <ConsultaResultados
        data={props.data}
        selectedIds={props.selectedIds}
        onToggle={props.onToggle}
        onMissingPdf={props.onMissingPdf}
        query={props.query}
        canFavorite={props.canFavorite}
        favoriteIds={props.favoriteIds}
        favoriteReady={props.favoriteReady}
        favoritePendingIds={props.favoritePendingIds}
        onToggleFavorite={props.onToggleFavorite}
      />
    );
  }

  return <BusquedaResultados data={props.data} internal query={props.query} />;
}

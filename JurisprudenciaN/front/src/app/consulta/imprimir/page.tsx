'use client';

import { useState } from 'react';
import { ConsultaPrintView } from '@/components/consulta/ConsultaPrintView';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { ConsultaPublicaResultado } from '@/types/busqueda';

const PRINT_STORAGE_KEY = 'consulta-print-payload';

export default function ConsultaImprimirPage() {
  const [items] = useState<ConsultaPublicaResultado[] | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const raw = localStorage.getItem(PRINT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as ConsultaPublicaResultado[];
    } catch {
      return [];
    }
  });

  if (items === null) {
    return <LoadingSpinner label="Preparando impresion..." />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Sin resultados para imprimir"
        description="Vuelva a la consulta pública y seleccione resultados o ejecute una búsqueda."
      />
    );
  }

  return <ConsultaPrintView items={items} />;
}

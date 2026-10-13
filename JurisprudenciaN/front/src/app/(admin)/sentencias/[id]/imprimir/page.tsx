'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FichaSentenciaPrint } from '@/components/sentencias/FichaSentenciaPrint';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api } from '@/lib/api';
import type { ApiResponse } from '@/types/common';
import type { FichaSentencia } from '@/types/sentencia';

export default function SentenciaFichaPrintPage() {
  const params = useParams<{ id: string }>();
  const [ficha, setFicha] = useState<FichaSentencia | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await api.get<ApiResponse<FichaSentencia>>(
          `/sentencias/${params.id}/ficha`,
        );
        if (!active) return;
        setFicha(response.data);
        window.setTimeout(() => window.print(), 250);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'No se pudo cargar la ficha de la sentencia.',
        );
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [params.id]);

  if (!ficha && !error) {
    return <LoadingSpinner label="Cargando ficha..." />;
  }

  if (!ficha) {
    return (
      <EmptyState
        title="Ficha no disponible"
        description={error ?? 'No se pudo cargar la ficha de la sentencia.'}
      />
    );
  }

  return <FichaSentenciaPrint ficha={ficha} />;
}

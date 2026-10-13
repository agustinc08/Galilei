'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CatalogoItem } from '@/types/catalogos';

type CatalogosState = {
  salas: CatalogoItem[];
  tiposFallo: CatalogoItem[];
  tribunalesOrigen: CatalogoItem[];
  isLoading: boolean;
  error: string | null;
};

export function useCatalogos(skipAuth = false) {
  const [state, setState] = useState<CatalogosState>({
    salas: [],
    tiposFallo: [],
    tribunalesOrigen: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [salas, tiposFallo, tribunalesOrigen] = await Promise.all([
          api.get<{ data: CatalogoItem[] }>('/catalogos/salas', { skipAuth }),
          api.get<{ data: CatalogoItem[] }>('/catalogos/tipos-fallo', { skipAuth }),
          api.get<{ data: CatalogoItem[] }>('/catalogos/tribunales-origen', { skipAuth }),
        ]);

        if (!active) return;

        setState({
          salas: salas.data,
          tiposFallo: tiposFallo.data,
          tribunalesOrigen: tribunalesOrigen.data,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        setState((current) => ({
          ...current,
          isLoading: false,
          error: error instanceof Error ? error.message : 'No se pudieron cargar los catalogos.',
        }));
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [skipAuth]);

  return state;
}

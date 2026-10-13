'use client';

import { api } from './api';

type TrackEventoInput = {
  tipoEvento: string;
  sentenciaId?: number;
  metadata?: Record<string, unknown>;
};

export async function trackEvento(input: TrackEventoInput) {
  try {
    await api.post('/estadisticas/eventos', input);
  } catch {
    try {
      await api.post('/public/eventos', input, { skipAuth: true });
    } catch {
      return;
    }
  }
}

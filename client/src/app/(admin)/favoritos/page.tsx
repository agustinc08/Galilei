'use client';

import { Link } from "@/lib/router-compat";
import { useEffect, useState } from 'react';
import styles from '@/components/sentencias/sentencias.module.css';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Table } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types/common';
import type { Favorito } from '@/types/favorito';

export default function FavoritosPage() {
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ApiResponse<Favorito[]>>('/favoritos');
      setFavoritos(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los favoritos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      try {
        const response = await api.get<ApiResponse<Favorito[]>>('/favoritos');
        if (active) {
          setFavoritos(response.data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los favoritos.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadInitial();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.section}>
      <PageHeader
        title="Favoritos"
        description="Sentencias guardadas por el usuario autenticado."
      />

      {error ? <StatusMessage variant="error" title="Error" message={error} /> : null}

      {isLoading ? (
        <LoadingSpinner label="Cargando favoritos..." />
      ) : favoritos.length === 0 ? (
        <EmptyState title="No hay favoritos" description="Guarda sentencias desde el detalle para encontrarlas rapido aqui." />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Sentencia</th>
                <th>Expediente</th>
                <th>Fecha</th>
                <th>Guardada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {favoritos.map((favorito) => (
                <tr key={favorito.id}>
                  <td>{favorito.sentencia.numeroSentencia ?? `#${favorito.sentencia.id}`}</td>
                  <td>{favorito.sentencia.expediente ?? '-'}</td>
                  <td>{formatDate(favorito.sentencia.fecha)}</td>
                  <td>{formatDate(favorito.createdAt)}</td>
                  <td>
                    <div className={styles.inlineActions}>
                      <Link href={`/sentencias/${favorito.sentenciaId}`}>
                        <Button variant="secondary">Abrir</Button>
                      </Link>
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await api.delete(`/favoritos/${favorito.sentenciaId}`);
                          await load();
                        }}
                      >
                        Quitar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
